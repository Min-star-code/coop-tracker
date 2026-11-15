import { useEffect, useMemo, useState } from "react";
import { api, SOURCES, STATUSES, type Application, type Status, type StatusEvent } from "../api";
import { StatusBadge, fmtDate } from "../ui";

const PAGE = 50;

export function Applications({ canEdit }: { canEdit: boolean }) {
  const [statuses, setStatuses] = useState<Status[]>(() => {
    const s = sessionStorage.getItem("statusFilter");
    sessionStorage.removeItem("statusFilter");
    return s ? [s as Status] : [];
  });
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState("updated");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Application[]; total: number }>();
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [reload, setReload] = useState(0);

  // Wait until typing pauses before searching, instead of one request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ sort, limit: String(PAGE), offset: String(offset) });
    if (statuses.length) p.set("status", statuses.join(","));
    if (source) p.set("source", source);
    if (debouncedQ) p.set("q", debouncedQ);
    return p;
  }, [statuses, source, debouncedQ, sort, offset]);

  useEffect(() => {
    let stale = false; // ignore a slow older response that arrives after a newer one
    api.list(params).then(
      (d) => !stale && (setData(d), setError("")),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [params, reload]);

  // Any filter change goes back to the first page.
  useEffect(() => setOffset(0), [statuses, source, debouncedQ, sort]);

  const toggle = (s: Status) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <section>
      <h2>Applications</h2>
      <div className="filters">
        <input
          type="search"
          placeholder="Search company, title or job id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="updated">Recently updated</option>
          <option value="deadline">Deadline</option>
          <option value="company">Company A–Z</option>
        </select>
      </div>
      <div className="chips" role="group" aria-label="Status filter">
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${statuses.includes(s) ? "on" : ""}`} onClick={() => toggle(s)} aria-pressed={statuses.includes(s)}>
            {s}
          </button>
        ))}
        {statuses.length > 0 && (
          <button className="link" onClick={() => setStatuses([])}>
            clear
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted small" data-testid="result-count">
            {data.total} result{data.total === 1 ? "" : "s"}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th className="hide-sm">Source</th>
                  <th className="hide-sm">Applied</th>
                  <th className="hide-sm">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} onClick={() => setOpenId(a.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpenId(a.id)}>
                    <td>
                      <div className="title">{a.title}</div>
                      <div className="muted small">{a.ww_job_id ? `WW ${a.ww_job_id}` : a.external_id}</div>
                    </td>
                    <td>{a.company}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="hide-sm">{a.source}</td>
                    <td className="hide-sm">{fmtDate(a.applied_on)}</td>
                    <td className="hide-sm">{fmtDate(a.deadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ← Prev
            </button>
            <span className="muted small">
              {data.total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
            </span>
            <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
              Next →
            </button>
          </div>
        </>
      )}

      {openId !== null && (
        <Detail id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onSaved={() => setReload((n) => n + 1)} />
      )}
    </section>
  );
}

function Detail({ id, canEdit, onClose, onSaved }: { id: number; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const [app, setApp] = useState<Application & { events: StatusEvent[] }>();
  const [status, setStatus] = useState<Status>("Saved");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get(id).then((a) => {
      setApp(a);
      setStatus(a.status);
      setNote(a.note ?? "");
    }, (e) => setMsg(e.message));
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (!app) return;
    const changes: { status?: Status; note?: string | null } = {};
    if (status !== app.status) changes.status = status;
    if (note !== (app.note ?? "")) changes.note = note || null;
    if (Object.keys(changes).length === 0) return setMsg("No changes.");
    try {
      await api.update(app.id, changes);
      setApp(await api.get(app.id));
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label="Application details" onClick={(e) => e.stopPropagation()}>
        <button className="close link" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {!app ? (
          <p className="muted">{msg || "Loading…"}</p>
        ) : (
          <>
            <h3>{app.title}</h3>
            <p>
              {app.company} · <span className="muted">{app.ww_job_id ? `WaterlooWorks ${app.ww_job_id}` : app.source}</span>
            </p>
            {app.url && (
              <p>
                <a href={app.url} target="_blank" rel="noreferrer noopener">
                  Posting link ↗
                </a>
              </p>
            )}
            <dl className="facts">
              <dt>Applied</dt>
              <dd>{fmtDate(app.applied_on)}</dd>
              <dt>Deadline</dt>
              <dd>{fmtDate(app.deadline)}</dd>
            </dl>

            {canEdit ? (
              <div className="edit">
                <label>
                  Status
                  <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Note
                  <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} />
                </label>
                <button onClick={save}>Save</button>
                {msg && <span className="muted small"> {msg}</span>}
              </div>
            ) : (
              <>
                <p>
                  <StatusBadge status={app.status} />
                </p>
                {app.note && <p className="note">{app.note}</p>}
                <p className="muted small">Read-only access.</p>
              </>
            )}

            <h4>Timeline</h4>
            <ol className="timeline">
              {app.events.map((e, i) => (
                <li key={i}>
                  <span className="muted small">{new Date(e.changed_at).toLocaleDateString("en-CA", { timeZone: "America/Toronto" })}</span>{" "}
                  {e.from_status ? `${e.from_status} → ` : ""}
                  <strong>{e.to_status}</strong>
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>
  );
}
