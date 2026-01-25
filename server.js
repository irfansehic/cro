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

// Common proxy function
async function proxyToEoglasna(req, res, upstreamPath) {
  try {
    const page = Math.max(0, toInt(req.query.page, 0));
    const size = Math.min(50, Math.max(1, toInt(req.query.size, 20))); // keep sane limits
    const sort = String(req.query.sort || "datePublished,desc");

    // Optional search text (supported by docs/examples for /notice; harmless if ignored elsewhere)
    const text = (req.query.text || "").toString().trim();

    const url = new URL(BASE_URL + upstreamPath);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(size));
    url.searchParams.set("sort", sort);

    if (text.length > 0) url.searchParams.set("text", text);

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "e-pravosudje-api-tester/1.0"
      }
    });

    // Forward rate-limit hint if present (documented behavior for HTTP 429)
    const retryAfterMs = upstream.headers.get("X-Rate-Limit-Retry-After-Milliseconds");
    if (retryAfterMs) res.setHeader("X-Rate-Limit-Retry-After-Milliseconds", retryAfterMs);

    const contentType = upstream.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await upstream.json()
      : await upstream.text();

    res.status(upstream.status).send(body);
  } catch (err) {
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
});
