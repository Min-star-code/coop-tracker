import { useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import { Login } from "./pages/Login";
import { Today } from "./pages/Today";
import { Dashboard } from "./pages/Dashboard";
import { Applications } from "./pages/Applications";
import { Classify } from "./pages/Classify";
import { Tailor } from "./pages/Tailor";

type Page = "today" | "dashboard" | "applications" | "classify" | "tailor";
const pageFromHash = (): Page => {
  const h = location.hash.slice(1);
  return h === "dashboard" || h === "applications" || h === "classify" || h === "tailor" ? h : "today";
};

export function App() {
  // undefined = still checking the session, null = signed out
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    api.me().then(setMe, (e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)));
    const onHash = () => setPage(pageFromHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  if (me === undefined) return <p className="center muted">Loading…</p>;
  if (me === null) return <Login onLogin={setMe} />;

  const isOwner = me.role === "owner";
  const nav: [Page, string][] = [
    ["today", "Today"],
    ["dashboard", "Overview"],
    ["applications", "Applications"],
    // Owner-only: these call the LLM, and Tailor reads my private resume notes.
    ...(isOwner ? ([["classify", "Classify a posting"], ["tailor", "Tailor resume"]] as [Page, string][]) : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">Co-op Tracker</strong>
        <nav>
          {nav.map(([p, label]) => (
            <a key={p} href={`#${p}`} className={page === p ? "active" : ""}>
              {label}
            </a>
          ))}
        </nav>
        <span className="who">
          {me.email} <span className={`badge role-${me.role}`}>{me.role}</span>
          <button
            className="link"
            onClick={async () => {
              await api.logout();
              setMe(null);
            }}
          >
            Sign out
          </button>
        </span>
      </header>
      <main>
        {page === "today" && <Today canEdit={isOwner} />}
        {page === "dashboard" && <Dashboard />}
        {page === "applications" && <Applications canEdit={isOwner} />}
        {page === "classify" && isOwner && <Classify />}
        {page === "tailor" && isOwner && <Tailor />}
      </main>
    </div>
  );
}
