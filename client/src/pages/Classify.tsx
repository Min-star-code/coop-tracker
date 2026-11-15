import { useState } from "react";
import { api, type Classification } from "../api";

const LABEL: Record<string, string> = {
  citizen_pr: "Requires citizen / PR — skip",
  portfolio_design: "Portfolio / design",
  waterloo: "Waterloo region (or remote)",
  other: "Other",
};

export function Classify() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Classification>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await api.classify(text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Classify a posting</h2>
      <p className="muted small">
        Paste the full job posting. Gemini sorts it into one of four buckets and quotes the deciding fact.
      </p>
      <textarea
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Job title, location, requirements…"
        aria-label="Job posting"
      />
      <div className="row">
        <button onClick={run} disabled={busy || text.trim().length < 50}>
          {busy ? "Classifying…" : "Classify"}
        </button>
        <span className="muted small">{text.trim().length < 50 ? "At least 50 characters" : `${text.length} characters`}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <div className={`card result cat-${result.category}`} data-testid="classification">
          <div className="result-cat">{LABEL[result.category] ?? result.category}</div>
          <p>{result.reason}</p>
          <p className="muted small">Model: {result.model}</p>
        </div>
      )}
    </section>
  );
}
