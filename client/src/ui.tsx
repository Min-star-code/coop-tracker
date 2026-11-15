import type { Status } from "./api";

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge st-${status.toLowerCase()}`}>{status}</span>;
}

/** Whole days from today (Toronto) until a YYYY-MM-DD date. */
export function daysUntil(date: string): number {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

/** Show a date string as-is; dates are already local days, so no Date() time-zone shift. */
export const fmtDate = (d: string | null) => d ?? "—";
