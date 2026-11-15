import { useCallback, useEffect, useState } from "react";
import { api, type Application, type Category, type TodayQueue } from "../api";
import { daysUntil } from "../ui";

const CATEGORY: Record<Category, string> = {
  citizen_pr: "Citizen / PR",
  portfolio_design: "Portfolio / design",
  waterloo: "Waterloo",
  other: "Other",
};
const SKIP_REASONS = ["Not my field", "Too many applicants", "Hard requirement I don't meet", "Location", "Not interested"];

export function Today({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<TodayQueue>();
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.today().then(setData, (e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  // Remove the card at once (optimistic), then reload counts from the server.
  async function act(app: Application, status: "Applied" | "Skipped", reason?: string) {
    setData((d) => d && { ...d, items: d.items.filter((a) => a.id !== app.id) });
    const note = reason ? [app.note, `Skipped on website: ${reason}`].filter(Boolean).join("\n") : undefined;
    try {
      await api.update(app.id, note === undefined ? { status } : { status, note });
    } catch (e) {
      setError(`Could not save ${app.title}: ${(e as Error).message}`);
    }
    load();
  }

  return (
    <section>
      <div className="today-head">
        <h2>To apply</h2>
        <span className="muted small" data-testid="week">
          This week: <strong>{data.week.applied}</strong> applied · {data.week.skipped} skipped
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="empty">Nothing waiting. New postings show up here after the daily sort.</p>
      ) : (
        <ul className="queue">
          {data.items.map((a) => (
            <Card key={a.id} app={a} canEdit={canEdit} onAct={act} />
          ))}
        </ul>
      )}

      <p className="muted small">
        Not shown: {data.expired} past deadline · {data.hidden_pr} citizen/PR-only · {data.unsorted} saved before
        sorting started (see Applications).
      </p>
    </section>
  );
}

function Card({ app, canEdit, onAct }: {
  app: Application;
  canEdit: boolean;
  onAct: (a: Application, s: "Applied" | "Skipped", reason?: string) => void;
}) {
  const [skipping, setSkipping] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = app.deadline ? daysUntil(app.deadline) : null;
  const facts = [
    app.location,
    app.duration,
    app.applicants !== null ? `${app.applicants} applicants` : null,
    app.cover_letter === null ? null : app.cover_letter ? "cover letter required" : "no cover letter",
  ].filter(Boolean);

  return (
    <li className="qcard" data-testid="queue-item">
      <div className={`qdue ${d !== null && d <= 1 ? "urgent" : ""}`}>
        {d === null ? "no date" : d === 0 ? "today" : d === 1 ? "tomorrow" : `${d} days`}
      </div>
      <div className="qbody">
        <div className="qtitle">
          <strong>{app.title}</strong> · {app.company}
          {app.category && <span className={`badge cat-b-${app.category}`}>{CATEGORY[app.category]}</span>}
          {app.cover_letter && <span className="badge st-saved">CL</span>}
        </div>
        <div className="muted small">
          {app.ww_job_id && <>WW {app.ww_job_id} · </>}
          {facts.join(" · ")}
        </div>
        {app.brief && <p className="qbrief">{app.brief}</p>}
        {canEdit && (
          <div className="qactions">
            <button onClick={() => onAct(app, "Applied")}>Applied</button>
            {skipping ? (
              <select
                autoFocus
                defaultValue=""
                aria-label="Skip reason"
                onChange={(e) => e.target.value && onAct(app, "Skipped", e.target.value)}
                onBlur={() => setSkipping(false)}
              >
                <option value="" disabled>Why skip?</option>
                {SKIP_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            ) : (
              <button className="secondary" onClick={() => setSkipping(true)}>Skip</button>
            )}
            {app.ww_job_id && (
              <button
                className="link"
                onClick={async () => {
                  await navigator.clipboard?.writeText(app.ww_job_id!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy job ID"}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
