import { useEffect, useState } from "react";
import { api, STATUSES, type Application, type Stats } from "../api";
import { StatusBadge, daysUntil } from "../ui";

const SOURCE_LABEL: Record<string, string> = {
  waterlooworks: "WaterlooWorks",
  company_site: "Company site",
  linkedin: "LinkedIn",
  referral: "Referral",
  other: "Other",
};

export function Dashboard() {
  const [stats, setStats] = useState<Stats>();
  const [due, setDue] = useState<Application[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.stats(), api.deadlines(14)]).then(
      ([s, d]) => {
        setStats(s);
        setDue(d.items);
      },
      (e) => setError(e.message),
    );
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats || !due) return <p className="muted">Loading…</p>;

  const total = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);
  const pipeline = STATUSES.filter((s) => s !== "Skipped");

  return (
    <>
      <section>
        <h2>Pipeline</h2>
        <div className="stat-grid">
          <a className="stat" href="#applications">
            <span className="stat-n">{total}</span>
            <span className="stat-label">tracked jobs</span>
          </a>
          {pipeline.map((s) => (
            <a key={s} className="stat" href="#applications" onClick={() => sessionStorage.setItem("statusFilter", s)}>
              <span className="stat-n">{stats.byStatus[s] ?? 0}</span>
              <span className="stat-label">{s}</span>
            </a>
          ))}
        </div>
        <p className="muted small">
          Skipped: {stats.byStatus.Skipped ?? 0} ·{" "}
          {Object.entries(stats.bySource)
            .map(([k, n]) => `${SOURCE_LABEL[k] ?? k}: ${n}`)
            .join(" · ")}
        </p>
      </section>

      <section>
        <h2>Deadlines in the next 14 days</h2>
        <p className="muted small">Saved jobs not applied to yet, soonest first.</p>
        {due.length === 0 ? (
          <p className="empty">Nothing due. Deadlines appear here when the sync records them.</p>
        ) : (
          <ul className="due-list">
            {due.map((a) => {
              const d = daysUntil(a.deadline!);
              return (
                <li key={a.id}>
                  <span className={`due ${d <= 2 ? "urgent" : ""}`}>{d === 0 ? "today" : `${d} d`}</span>
                  <span>
                    <strong>{a.title}</strong> · {a.company}
                  </span>
                  <StatusBadge status={a.status} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
