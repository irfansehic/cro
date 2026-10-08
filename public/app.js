const { useEffect, useMemo, useRef, useState } = React;

const pad2 = (n) => String(n).padStart(2, "0");

// Shows dates as DD.MM.YYYY (and date-times as DD.MM.YYYY HH:MM:SS)
function fmtDate(s) {
  if (!s) return "—";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (plain) return `${plain[3]}.${plain[2]}.${plain[1]}`; // date only: no timezone shift
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return (
    `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

// "DD.MM.YYYY" (also D.M.YYYY, optional trailing dot) -> "YYYY-MM-DD", or null if invalid
function parseDmy(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(String(text).trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function safeStr(v) {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s.length ? s : "—";
}

function searchUrl(mode, text) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("mode", mode);
  url.searchParams.set("text", String(text).trim());
  return url.toString();
}

function ListItem({ item, mode }) {
  const title = safeStr(item.title);
  const publicUrl = item.publicUrl;

  const docsBundleUrl = item.noticeDocumentsDownloadUrl;
  const docs = Array.isArray(item.noticeDocuments) ? item.noticeDocuments : [];
  const participants = Array.isArray(item.participants) ? item.participants : [];

  const courtName = item?.court?.name;
  const courtCode = item?.court?.code;
  const courtType = item?.court?.courtType;

  const caseNumber = item?.caseNumber;
  const caseType = item?.caseType;

  return (
    <div className="card">
      <div className="row">
        <div style={{ flex: "1 1 700px" }}>
          <div className="title">{title}</div>

          <div className="meta">
            <div>
              <span className="badge">{safeStr(item.noticeType)}</span>{" "}
              <span className="badge">{safeStr(item.noticeSourceType)}</span>
              {caseType ? (
                <>
                  {" "}
                  <span className="badge">{safeStr(caseType)}</span>
                </>
              ) : null}
            </div>

            {courtName && (
              <div>
                Sud: {safeStr(courtName)}
                {courtCode ? ` (${courtCode})` : ""}
                {courtType ? ` · ${courtType}` : ""}
              </div>
            )}

            {caseNumber && <div>Predmet: {safeStr(caseNumber)}</div>}

            <div>Objavljeno: {fmtDate(item.datePublished)}</div>
            <div>Istječe: {fmtDate(item.expirationDate)}</div>
            <div>UUID: {safeStr(item.uuid)}</div>

            <div style={{ marginTop: 6 }}>
              {publicUrl ? (
                <>
                  Oglas:{" "}
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    Otvori
                  </a>
                </>
              ) : (
                <>Oglas: —</>
              )}

              {" · "}

              {docsBundleUrl ? (
                <>
                  Svi dokumenti:{" "}
                  <a href={docsBundleUrl} target="_blank" rel="noreferrer">
                    Preuzmi
                  </a>
                </>
              ) : (
                <>Svi dokumenti: —</>
              )}
            </div>

            {docs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 600, color: "#cbd5e1", marginBottom: 4 }}>
                  Dokumenti
                </div>
                {docs
                  .slice()
                  .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
                  .map((d, idx) => {
                    const decision = d.vrstaOdlukeNaziv || d.vrstaOdlukeId;
                    return (
                      <div key={d.uuid ?? `doc-${idx}`}>
                        {safeStr(d.fileName)}
                        {decision ? (
                          <div className="small">Vrsta odluke: {safeStr(decision)}</div>
                        ) : null}
                        {d.downloadUrl ? (
                          <div className="small">
                            <a href={d.downloadUrl} target="_blank" rel="noreferrer">
                              Direktno preuzimanje
                            </a>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {participants.length > 0 && (
          <div style={{ flex: "0 1 320px" }}>
            <div className="meta">
              <div style={{ marginBottom: 6, fontWeight: 600, color: "#cbd5e1" }}>
                Sudionici
              </div>

              {participants.slice(0, 10).map((p, idx) => {
                const displayName = p.fullName || p.name || p.titles;
                return (
                  <div key={`p-${idx}`} style={{ marginBottom: 8 }}>
                    {safeStr(p.participantType)}:{" "}
                    {displayName ? (
                      <a
                        href={searchUrl(mode, displayName)}
                        target="_blank"
                        rel="noreferrer"
                        title="Pretraži ovog sudionika u novoj kartici"
                      >
                        {safeStr(displayName)}
                      </a>
                    ) : (
                      "—"
                    )}{" "}
                    {p.debtor === true ? "(dužnik)" : ""}
                    {p.oib ? (
                      <div className="small">
                        OIB:{" "}
                        <a
                          href={searchUrl(mode, p.oib)}
                          target="_blank"
                          rel="noreferrer"
                          title="Pretraži po OIB-u u novoj kartici"
                        >
                          {p.oib}
                        </a>
                      </div>
                    ) : null}
                    {p.address ? (
                      <div className="small">
                        Adresa:{" "}
                        <a
                          href={searchUrl(mode, p.address)}
                          target="_blank"
                          rel="noreferrer"
                          title="Pretraži po adresi u novoj kartici"
                        >
                          {p.address}
                        </a>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {participants.length > 10 && (
                <div className="small">+ još {participants.length - 10}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



// Text field in DD.MM.YYYY with a calendar button; value/onChange use YYYY-MM-DD ("" when empty)
function DateInput({ value, onChange, disabled, min, max }) {
  const [text, setText] = useState(fmtDateOrEmpty(value));
  const pickerRef = useRef(null);

  useEffect(() => {
    // keep the text in sync when the value changes from outside (e.g. the calendar)
    if (parseDmy(text) !== value) setText(fmtDateOrEmpty(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const invalid = text.trim() !== "" && parseDmy(text) === null;

  function handleText(t) {
    setText(t);
    if (t.trim() === "") onChange("");
    else {
      const iso = parseDmy(t);
      if (iso) onChange(iso);
    }
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.click();
  }

  return (
    <span className="dateInput">
      <input
        type="text"
        inputMode="numeric"
        placeholder="DD.MM.YYYY"
        value={text}
        disabled={disabled}
        className={invalid ? "invalid" : ""}
        title={invalid ? "Neispravan datum, koristi DD.MM.YYYY" : undefined}
        onChange={(e) => handleText(e.target.value)}
      />
      <button type="button" className="calBtn" disabled={disabled} onClick={openPicker} title="Odaberi datum">
        📅
      </button>
      <input
        ref={pickerRef}
        type="date"
        className="hiddenPicker"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

function fmtDateOrEmpty(iso) {
  return iso ? fmtDate(iso) : "";
}

function DateRangeFilter({ label, range, onChange }) {
  const { enabled, from, to } = range;
  return (
    <div className="toolbar dateFilter">
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...range, enabled: e.target.checked })}
        />
        {label}
      </label>
      <label className={enabled ? "" : "disabled"}>
        Od{" "}
        <DateInput
          value={from}
          max={to}
          disabled={!enabled}
          onChange={(v) => onChange({ ...range, from: v })}
        />
      </label>
      <label className={enabled ? "" : "disabled"}>
        Do{" "}
        <DateInput
          value={to}
          min={from}
          disabled={!enabled}
          onChange={(v) => onChange({ ...range, to: v })}
        />
      </label>
    </div>
  );
}

const EMPTY_RANGE = { enabled: false, from: "", to: "" };

function PaginatedList({ mode, initialText = "" }) {
  // mode: "notice" | "bankruptcy"
  const [page, setPage] = useState(0);
  const [size] = useState(20);
  const [text, setText] = useState(initialText);
  const [published, setPublished] = useState(EMPTY_RANGE);
  const [expires, setExpires] = useState(EMPTY_RANGE);
  const requestId = useRef(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [data, setData] = useState(null);

  const endpoint = useMemo(() => {
    return mode === "bankruptcy" ? "/api/bankruptcy" : "/api/notice";
  }, [mode]);

  async function load(p) {
    const myRequest = ++requestId.current;
    setLoading(true);
    setErr(null);

    try {
      const url = new URL(window.location.origin + endpoint);
      url.searchParams.set("page", String(p));
      url.searchParams.set("size", String(size));
      url.searchParams.set("sort", "datePublished,desc");
      if (text.trim().length) url.searchParams.set("text", text.trim());
      if (published.enabled) {
        if (published.from) url.searchParams.set("dateFrom", published.from);
        if (published.to) url.searchParams.set("dateTo", published.to);
      }
      if (expires.enabled) {
        if (expires.from) url.searchParams.set("expFrom", expires.from);
        if (expires.to) url.searchParams.set("expTo", expires.to);
      }

      const r = await fetch(url.toString(), { headers: { "Accept": "application/json" } });

      // handle documented 429 with retry header
      if (r.status === 429) {
        const retryMs = r.headers.get("X-Rate-Limit-Retry-After-Milliseconds");
        throw new Error(
          `Rate limit (429). Retry after ${retryMs ? retryMs + " ms" : "some time"}.`
        );
      }

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
      }

      const json = await r.json();
      if (myRequest !== requestId.current) return; // a newer request superseded this one
      setData(json);
      setPage(p);
    } catch (e) {
      if (myRequest !== requestId.current) return;
      setErr(e.message || String(e));
      setData(null);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    // load first page when this component is mounted
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  // Reload from page 1 when a date filter is toggled or its dates change
  const dateFilterMounted = useRef(false);
  useEffect(() => {
    if (!dateFilterMounted.current) {
      dateFilterMounted.current = true;
      return;
    }
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    published.enabled,
    published.enabled ? published.from : null,
    published.enabled ? published.to : null,
    expires.enabled,
    expires.enabled ? expires.from : null,
    expires.enabled ? expires.to : null
  ]);

  const content = Array.isArray(data?.content) ? data.content : [];
  const totalPages = Number.isFinite(data?.totalPages) ? data.totalPages : null;
  const isFirst = !!data?.first;
  const isLast = !!data?.last;

  return (
    <div>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Opcionalno: text (pojam pretrage)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button onClick={() => load(0)} disabled={loading}>
          Pretraži / Osvježi
        </button>
      </div>

      <DateRangeFilter label="Filtriraj po datumu objave" range={published} onChange={setPublished} />
      {/* bankruptcy notices carry no expiration date, so this filter only applies to notices */}
      {mode === "notice" && (
        <DateRangeFilter label="Filtriraj po datumu isteka" range={expires} onChange={setExpires} />
      )}
      {expires.enabled && (expires.from || expires.to) && (
        <div className="small" style={{ marginTop: -8, marginBottom: 12 }}>
          Uz filter isteka rezultati su poredani po datumu isteka (najraniji prvi).
        </div>
      )}

      {err && <div className="error">{err}</div>}

      <div className="pagination">
        <button onClick={() => load(Math.max(0, page - 1))} disabled={loading || isFirst}>
          ← Prethodna
        </button>
        <div>
          Stranica <b>{page + 1}</b>
          {totalPages !== null ? (
            <> / <b>{totalPages}</b></>
          ) : null}
          <span className="small"> (20 po stranici)</span>
        </div>
        <button onClick={() => load(page + 1)} disabled={loading || isLast}>
          Sljedeća →
        </button>
        {loading && <div className="small">Učitavanje…</div>}
      </div>

      {content.length === 0 && !loading && !err && (
        <div className="small">Nema rezultata za prikaz.</div>
      )}

      {content.map((item, idx) => (
      <ListItem key={item.uuid ?? `${mode}-${idx}`} item={item} mode={mode} />
      ))}

    </div>
  );
}

function RawPanel({ title, obj }) {
  if (!obj) return null;
  return (
    <div className="card">
      <div className="title">{title}</div>
      <pre style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "#e5e7eb",
        fontSize: 12,
        lineHeight: 1.4
      }}>
        {JSON.stringify(obj, null, 2)}
      </pre>
    </div>
  );
}


function App() {
  // Allow opening a search directly via ?mode=notice|bankruptcy&text=...
  const initialParams = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    const m = sp.get("mode");
    return {
      mode: m === "notice" || m === "bankruptcy" ? m : null,
      text: sp.get("text") || "",
    };
  }, []);

  const [active, setActive] = useState(initialParams.mode); // null | "notice" | "bankruptcy"

  const [rawNotice, setRawNotice] = useState(null);
  const [rawBankruptcy, setRawBankruptcy] = useState(null);
  const [rawErr, setRawErr] = useState(null);
  const [rawLoading, setRawLoading] = useState(false);

  async function loadRaw(which) {
    setRawLoading(true);
    setRawErr(null);
    try {
      const url = which === "notice" ? "/api/notice/first" : "/api/bankruptcy/first";
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 250)}`);
      const json = await r.json();
      if (which === "notice") setRawNotice(json);
      else setRawBankruptcy(json);
    } catch (e) {
      setRawErr(e.message || String(e));
    } finally {
      setRawLoading(false);
    }
  }

  useEffect(() => {
    if (initialParams.mode) loadRaw(initialParams.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  
  return (
    <div className="container">
      <h1>e pravosudje pretraga</h1>
      <div className="sub">
        Dva poziva prema e-Oglasnoj ploči (preko Node proxy-ja) i prikaz rezultata s paginacijom (20 po stranici).
      </div>

      <div className="toolbar">
        <button onClick={() => { setActive("notice"); loadRaw("notice"); }}>
      Ucitaj oglasne ploce sudova
      </button>
      <button onClick={() => { setActive("bankruptcy"); loadRaw("bankruptcy"); }}>
      Ucitaj bankrote
      </button>
      </div>

      {active === null && (
        <div className="small">
          Odaberi jednu od dvije opcije iznad.
        </div>
      )}

      {active === "notice" && (
        <>
          <div className="sectionTitle">Ucitaj oglasne ploce sudova</div>
          <PaginatedList
            mode="notice"
            initialText={initialParams.mode === "notice" ? initialParams.text : ""}
          />
        </>
      )}

      {active === "bankruptcy" && (
        <>
          <div className="sectionTitle">Ucitaj bankrote</div>
          <PaginatedList
            mode="bankruptcy"
            initialText={initialParams.mode === "bankruptcy" ? initialParams.text : ""}
          />
        </>
      )}

      <div style={{ marginTop: 18 }} className="small">
        Napomena: API ima rate limiting; ako dobiješ 429, pričekaj prema headeru{" "}
        <i>X-Rate-Limit-Retry-After-Milliseconds</i>.
      </div>

      {rawErr && <div className="error">{rawErr}</div>}
{rawLoading && <div className="small">Učitavanje raw JSON…</div>}

{active === "notice" && <RawPanel title="RAW (prvi element) - notice" obj={rawNotice} />}
{active === "bankruptcy" && <RawPanel title="RAW (prvi element) - bankruptcy" obj={rawBankruptcy} />}


    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
