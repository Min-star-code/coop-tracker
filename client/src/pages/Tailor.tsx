import { useState } from "react";
import { api, type Tailoring } from "../api";

const SOURCE: Record<string, string> = { outline: "Resume bullet", library: "Cover-letter paragraph" };

/**
 * RAG tailoring helper. The suggestions are my OWN stored bullets and paragraphs (retrieved by
 * embedding similarity); the LLM only chooses among them and explains the match in one line.
 */
export function Tailor() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Tailoring>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await api.tailor(text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Tailor my resume</h2>
      <p className="muted small">
        Paste a posting. The site finds my most relevant resume bullets and cover-letter paragraphs, then Gemini
        picks which to use. Every suggestion is my own text, with its source; nothing new is written for me.
      </p>
      <textarea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Job title, duties, required skills…"
        aria-label="Job posting"
      />
      <div className="row">
        <button onClick={run} disabled={busy || text.trim().length < 50}>
          {busy ? "Searching…" : "Suggest"}
        </button>
        <span className="muted small">{text.trim().length < 50 ? "At least 50 characters" : `${text.length} characters`}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div data-testid="tailoring">
          <h3>Use these</h3>
          {result.picks.length === 0 && <p className="muted">No excerpt matched well enough.</p>}
          {result.picks.map((p) => (
            <div key={p.id} className="card pick" data-testid="pick">
              <div className="small muted">
                {SOURCE[p.source]} · <strong>{p.ref}</strong> · similarity {p.score}
              </div>
              <blockquote>{p.text}</blockquote>
              <p className="why small">
                <strong>For:</strong> “{p.requirement}”{!p.quote_verified && <span className="muted"> (not an exact quote)</span>}
                {" — "}
                {p.why}
              </p>
            </div>
          ))}
          <div className="cols">
            <div className="card">
              <strong>Not covered by my material</strong>
              {result.gaps.length ? (
                <ul>{result.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              ) : (
                <p className="muted small">None found.</p>
              )}
            </div>
            <div className="card">
              <strong>Most similar past postings</strong>
              <ul>
                {result.similar.map((s) => (
                  <li key={s.ref}>
                    WW {s.ref} · {s.title ?? ""} {s.company ? `· ${s.company}` : ""} — <em>{s.status}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <details className="small" style={{ marginTop: "1rem" }}>
            <summary>
              Retrieved {result.retrieved.length} excerpts · {result.dropped.length} suggestion(s) blocked by the guard
            </summary>
            <ul>
              {result.retrieved.map((r) => (
                <li key={r.id}>
                  {r.score} · {r.ref}: {r.text.slice(0, 120)}…
                </li>
              ))}
              {result.dropped.map((d) => (
                <li key={`d${d.chunk_id}`} className="error">Blocked excerpt {d.chunk_id}: {d.reason}</li>
              ))}
            </ul>
            <p className="muted">Models: {result.embedding_model} (search), {result.model} (choice)</p>
          </details>
        </div>
      )}
    </section>
  );
}
