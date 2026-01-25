const { useEffect, useMemo, useState } = React;

function fmtDate(s) {
  if (!s) return "—";
  // Handles both date (YYYY-MM-DD) and date-time
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString("hr-HR");
}

function safeStr(v) {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  return s.length ? s : "—";
}

function ListItem({ item }) {
  // Both endpoints return Notice-like objects (per API schemas),
  // so we render common fields defensively.
  const title = safeStr(item.title);
  const publicUrl = item.publicUrl;
  const docsUrl = item.noticeDocumentsDownloadUrl;

  const participants = Array.isArray(item.participants) ? item.participants : [];

  return (
    <div className="card">
      <div className="row">
        <div style={{ flex: "1 1 700px" }}>
          <div className="title">{title}</div>
          <div className="meta">
            <div>
              <span className="badge">{safeStr(item.noticeType)}</span>{" "}
              <span className="badge">{safeStr(item.noticeSourceType)}</span>
            </div>
            <div>Objavljeno: {fmtDate(item.datePublished)}</div>
            <div>Istječe: {fmtDate(item.expirationDate)}</div>
            <div>UUID: {safeStr(item.uuid)}</div>
            <div>
              {publicUrl ? (
                <>
                  Oglas: <a href={publicUrl} target="_blank" rel="noreferrer">Otvori</a>
                </>
              ) : (
                <>Oglas: —</>
              )}
              {" · "}
              {docsUrl ? (
                <>
                  Dokumenti: <a href={docsUrl} target="_blank" rel="noreferrer">Preuzmi</a>
                </>
              ) : (
                <>Dokumenti: —</>
              )}
            </div>
          </div>
        </div>

        {participants.length > 0 && (
          <div style={{ flex: "0 1 320px" }}>
            <div className="meta">
              <div style={{ marginBottom: 6, fontWeight: 600, color: "#cbd5e1" }}>
                Sudionici
              </div>
              {participants.slice(0, 6).map((p, idx) => (
                <div key={idx}>
                  {safeStr(p.participantType)}: {safeStr(p.titles)}{" "}
                  {p.debtor === true ? "(dužnik)" : ""}
                </div>
              ))}
              {participants.length > 6 && (
                <div className="small">+ još {participants.length - 6}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PaginatedList({ mode }) {
  // mode: "notice" | "bankruptcy"
  const [page, setPage] = useState(0);
  const [size] = useState(20);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [data, setData] = useState(null);

  const endpoint = useMemo(() => {
    return mode === "bankruptcy" ? "/api/bankruptcy" : "/api/notice";
  }, [mode]);

  async function load(p) {
    setLoading(true);
    setErr(null);

    try {
      const url = new URL(window.location.origin + endpoint);
      url.searchParams.set("page", String(p));
      url.searchParams.set("size", String(size));
      url.searchParams.set("sort", "datePublished,desc");
      if (text.trim().length) url.searchParams.set("text", text.trim());

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
      setData(json);
      setPage(p);
    } catch (e) {
      setErr(e.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // load first page when this component is mounted
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

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

      {content.map((item) => (
        <ListItem key={item.uuid || Math.random()} item={item} />
      ))}
    </div>
  );
}

function App() {
  const [active, setActive] = useState(null); // null | "notice" | "bankruptcy"

  return (
    <div className="container">
      <h1>e pravosudje API tester</h1>
      <div className="sub">
        Dva poziva prema e-Oglasnoj ploči (preko Node proxy-ja) i prikaz rezultata s paginacijom (20 po stranici).
      </div>

      <div className="toolbar">
        <button onClick={() => setActive("notice")}>
          Ucitaj oglasne ploce sudova
        </button>
        <button onClick={() => setActive("bankruptcy")}>
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
          <PaginatedList mode="notice" />
        </>
      )}

      {active === "bankruptcy" && (
        <>
          <div className="sectionTitle">Ucitaj bankrote</div>
          <PaginatedList mode="bankruptcy" />
        </>
      )}

      <div style={{ marginTop: 18 }} className="small">
        Napomena: API ima rate limiting; ako dobiješ 429, pričekaj prema headeru{" "}
        <i>X-Rate-Limit-Retry-After-Milliseconds</i>.
      </div>

    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
