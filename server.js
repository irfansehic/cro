const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = "https://e-oglasna.pravosudje.hr";

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Small helper for safe ints
function toInt(v, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

// Thrown when upstream answers with a non-2xx status, so it can be forwarded as-is
class UpstreamError extends Error {
  constructor(status, body, retryAfterMs) {
    super(`Upstream HTTP ${status}`);
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// retries: how many times to wait out an HTTP 429 (using the upstream retry hint) before giving up
async function fetchUpstream(url, retries = 0) {
  for (let attempt = 0; ; attempt++) {
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "e-pravosudje-api-tester/1.0"
      }
    });

    const retryAfterMs = upstream.headers.get("X-Rate-Limit-Retry-After-Milliseconds");
    const contentType = upstream.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    if (upstream.status === 429 && attempt < retries) {
      await sleep(Math.min(5000, toInt(retryAfterMs, 1000)) + 50);
      continue;
    }
    if (!upstream.ok) throw new UpstreamError(upstream.status, body, retryAfterMs);
    return body;
  }
}

// Upstream URL with the filters the API supports natively (text + publish date range)
function buildUpstreamUrl(req, upstreamPath) {
  const url = new URL(BASE_URL + upstreamPath);
  const text = (req.query.text || "").toString().trim();
  if (text.length > 0) url.searchParams.set("text", text);
  if (isDate(req.query.dateFrom)) url.searchParams.set("datePublishedFrom", req.query.dateFrom);
  if (isDate(req.query.dateTo)) url.searchParams.set("datePublishedTo", req.query.dateTo);
  return url;
}

function withPage(baseUrl, page, size, sort) {
  const url = new URL(baseUrl);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));
  url.searchParams.set("sort", sort);
  return url;
}

/*
 * Expiration-date filtering.
 * The upstream API cannot filter by expirationDate, but it can sort by it. Sorted
 * ascending (nulls last), all notices inside [expFrom, expTo] form one contiguous
 * block. We find the block's two ends by searching over upstream pages, then serve
 * result pages by slicing that block.
 *
 * Upstream is rate limited (~1 req/s after a short burst), so the search keeps the
 * number of requests low: it probes whole pages of PROBE_SIZE items, picks probe
 * positions by interpolating on the dates (alternating with plain bisection, which
 * bounds the worst case), and caches every page it fetches.
 */
const EXP_SORT = "expirationDate,asc";
const PROBE_SIZE = 100; // largest page size upstream accepts
const MAX_RETRIES = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_CACHE_MAX = 300;
const pageCache = new Map(); // `${baseUrl}|${page}` -> { at, json }
const boundsCache = new Map(); // `${baseUrl}|${expFrom}|${expTo}` -> { at, start, end }
const datedCountCache = new Map(); // baseUrl -> { at, count }

const DAY_MS = 24 * 60 * 60 * 1000;
// YYYY-MM-DD -> day number; null (no expiration) sorts last, i.e. +Infinity
const dayNum = (s) => (s ? Math.floor(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / DAY_MS) : Infinity);

async function getProbePage(baseUrl, page) {
  const key = `${baseUrl}|${page}`;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;

  const json = await fetchUpstream(withPage(baseUrl, page, PROBE_SIZE, EXP_SORT), MAX_RETRIES);
  pageCache.set(key, { at: Date.now(), json });
  if (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
  return json;
}

function isPageCached(baseUrl, page) {
  const hit = pageCache.get(`${baseUrl}|${page}`);
  return !!hit && Date.now() - hit.at < CACHE_TTL_MS;
}

// First index in [lo, hi) whose expiration day is >= target (null counts as +Infinity), or hi
async function lowerBound(baseUrl, target, lo, hi) {
  let loVal = null; // day value just below lo, when known
  let hiVal = null; // day value at hi, when known
  let found = null;

  // Looks at the probe page containing idx and narrows [lo, hi); sets found when the boundary is in it
  async function probe(idx) {
    const page = Math.floor(idx / PROBE_SIZE);
    const json = await getProbePage(baseUrl, page);
    const days = (Array.isArray(json?.content) ? json.content : []).map((x) => dayNum(x.expirationDate));
    if (days.length === 0) {
      found = lo; // data shifted under us; stop safely
      return;
    }

    const pageStart = page * PROBE_SIZE;
    const pageEnd = pageStart + days.length;
    const firstHit = days.findIndex((d) => d >= target);

    if (firstHit === -1) {
      lo = Math.max(lo, pageEnd);
      loVal = days[days.length - 1];
    } else if (firstHit > 0 || pageStart <= lo) {
      found = Math.max(lo, Math.min(hi, pageStart + firstHit));
    } else {
      hi = Math.min(hi, pageStart);
      hiVal = days[0];
    }
  }

  // Pages at either end are often cached already (free to look at), which seeds the interpolation
  for (const idx of [lo, hi - 1]) {
    if (found === null && lo < hi && isPageCached(baseUrl, Math.floor(idx / PROBE_SIZE))) await probe(idx);
  }

  for (let step = 0; found === null && lo < hi; step++) {
    let idx = Math.floor((lo + hi) / 2);
    const canInterpolate =
      step % 2 === 0 && Number.isFinite(target) && Number.isFinite(loVal) && Number.isFinite(hiVal) && hiVal > loVal;
    if (canInterpolate) {
      const frac = Math.min(1, Math.max(0, (target - loVal) / (hiVal - loVal)));
      idx = Math.min(hi - 1, Math.max(lo, lo + Math.floor(frac * (hi - lo))));
    }
    await probe(idx);
  }
  return found === null ? lo : found;
}

// Number of notices that have an expiration date at all (they come before the nulls).
// Most notices have none, so this is the expensive part; it is cached per query.
async function datedCount(baseUrl) {
  const key = String(baseUrl);
  const hit = datedCountCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.count;

  const head = await getProbePage(baseUrl, 0);
  const n = Number(head?.totalElements) || 0;
  const count = await lowerBound(baseUrl, Infinity, 0, n);
  datedCountCache.set(key, { at: Date.now(), count });
  return count;
}

async function expirationBounds(baseUrl, expFrom, expTo) {
  const key = `${baseUrl}|${expFrom}|${expTo}`;
  const hit = boundsCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const dated = await datedCount(baseUrl);
  const start = expFrom ? await lowerBound(baseUrl, dayNum(expFrom), 0, dated) : 0;
  const end = expTo ? await lowerBound(baseUrl, dayNum(expTo) + 1, start, dated) : dated;

  const entry = { at: Date.now(), start, end: Math.max(start, end) };
  boundsCache.set(key, entry);
  return entry;
}

async function pageByExpiration(baseUrl, expFrom, expTo, page, size) {
  const { start, end } = await expirationBounds(baseUrl, expFrom, expTo);
  const total = end - start;
  const totalPages = Math.ceil(total / size);

  const from = start + page * size;
  const to = Math.min(end, from + size);
  let content = [];

  if (from < to) {
    // slice the wanted range out of the (cached) probe-size pages that cover it
    const firstPage = Math.floor(from / PROBE_SIZE);
    const lastPage = Math.floor((to - 1) / PROBE_SIZE);
    const items = [];
    for (let p = firstPage; p <= lastPage; p++) {
      const json = await getProbePage(baseUrl, p);
      items.push(...(Array.isArray(json?.content) ? json.content : []));
    }
    content = items.slice(from - firstPage * PROBE_SIZE, to - firstPage * PROBE_SIZE);
  }

  return {
    content,
    totalElements: total,
    totalPages,
    number: page,
    size,
    first: page === 0,
    last: page >= totalPages - 1
  };
}

// Common proxy function
async function proxyToEoglasna(req, res, upstreamPath) {
  try {
    const page = Math.max(0, toInt(req.query.page, 0));
    const size = Math.min(50, Math.max(1, toInt(req.query.size, 20))); // keep sane limits
    const sort = String(req.query.sort || "datePublished,desc");

    const baseUrl = buildUpstreamUrl(req, upstreamPath);
    const expFrom = isDate(req.query.expFrom) ? req.query.expFrom : null;
    const expTo = isDate(req.query.expTo) ? req.query.expTo : null;

    const body = expFrom || expTo
      ? await pageByExpiration(baseUrl, expFrom, expTo, page, size)
      : await fetchUpstream(withPage(baseUrl, page, size, sort));

    res.status(200).send(body);
  } catch (err) {
    if (err instanceof UpstreamError) {
      // Forward rate-limit hint if present (documented behavior for HTTP 429)
      if (err.retryAfterMs) res.setHeader("X-Rate-Limit-Retry-After-Milliseconds", err.retryAfterMs);
      return res.status(err.status).send(err.body);
    }
    res.status(500).json({
      message: "Proxy error while calling e-oglasna API",
      error: String(err?.message || err)
    });
  }
}

// Your app endpoints (same-origin for frontend)
app.get("/api/notice", (req, res) => proxyToEoglasna(req, res, "/api/v1/notice"));
app.get("/api/bankruptcy", (req, res) =>
  proxyToEoglasna(req, res, "/api/v1/court-notice/legal-person-bankruptcy")
);

app.get("/api/notice/first", async (req, res) => {
  // fetch page 0, size 1 and return content[0]
  req.query.page = "0";
  req.query.size = "1";
  try {
    const url = new URL("http://localhost" + "/api/notice"); // dummy, we won't use
    // reuse existing proxyToEoglasna by directly calling upstream:
    const upstreamUrl = new URL("https://e-oglasna.pravosudje.hr/api/v1/notice");
    upstreamUrl.searchParams.set("page", "0");
    upstreamUrl.searchParams.set("size", "1");
    upstreamUrl.searchParams.set("sort", "datePublished,desc");

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "application/json", "User-Agent": "e-pravosudje-api-tester/1.0" },
    });

    const retryAfterMs = upstream.headers.get("X-Rate-Limit-Retry-After-Milliseconds");
    if (retryAfterMs) res.setHeader("X-Rate-Limit-Retry-After-Milliseconds", retryAfterMs);

    const json = await upstream.json();
    const first = Array.isArray(json?.content) ? json.content[0] : null;
    res.status(200).json(first ?? { message: "No content[0] found", raw: json });
  } catch (e) {
    res.status(500).json({ message: "Failed to load first notice", error: String(e?.message || e) });
  }
});

app.get("/api/bankruptcy/first", async (req, res) => {
  try {
    const upstreamUrl = new URL(
      "https://e-oglasna.pravosudje.hr/api/v1/court-notice/legal-person-bankruptcy"
    );
    upstreamUrl.searchParams.set("page", "0");
    upstreamUrl.searchParams.set("size", "1");
    upstreamUrl.searchParams.set("sort", "datePublished,desc");

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { Accept: "application/json", "User-Agent": "e-pravosudje-api-tester/1.0" },
    });

    const retryAfterMs = upstream.headers.get("X-Rate-Limit-Retry-After-Milliseconds");
    if (retryAfterMs) res.setHeader("X-Rate-Limit-Retry-After-Milliseconds", retryAfterMs);

    const json = await upstream.json();
    const first = Array.isArray(json?.content) ? json.content[0] : null;
    res.status(200).json(first ?? { message: "No content[0] found", raw: json });
  } catch (e) {
    res.status(500).json({ message: "Failed to load first bankruptcy notice", error: String(e?.message || e) });
  }
});


// SPA fallback (so direct refresh still loads)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Warm up the expensive part of expiration-date filtering for the unfiltered lists
  (async () => {
    for (const p of ["/api/v1/notice", "/api/v1/court-notice/legal-person-bankruptcy"]) {
      await datedCount(new URL(BASE_URL + p)).catch(() => {});
    }
  })();
});
