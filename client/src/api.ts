// Thin typed wrapper around fetch for the REST API.

export const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Ranked", "Rejected", "Skipped"] as const;
export const SOURCES = ["waterlooworks", "company_site", "linkedin", "referral", "other"] as const;
export type Status = (typeof STATUSES)[number];

export interface Me { email: string; role: "owner" | "viewer" }
export interface Application {
  id: number;
  source: string;
  ww_job_id: string | null;
  external_id: string | null;
  company: string;
  title: string;
  url: string | null;
  status: Status;
  applied_on: string | null;
  deadline: string | null;
  note: string | null;
  category: Category | null;
  brief: string | null;
  location: string | null;
  duration: string | null;
  applicants: number | null;
  cover_letter: boolean | null;
  updated_at: string;
}
export type Category = "citizen_pr" | "portfolio_design" | "waterloo" | "other";
export interface TodayQueue {
  today: string;
  items: Application[];
  expired: number;
  unsorted: number;
  hidden_pr: number;
  week: { applied: number; skipped: number };
}
export interface StatusEvent { from_status: Status | null; to_status: Status; changed_at: string }
export interface Stats { byStatus: Record<string, number>; bySource: Record<string, number> }
export interface Classification { category: string; reason: string; model: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      // Required by the server's CSRF guard on every write.
      "X-Requested-With": "coop-tracker",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join("; ");
    throw new ApiError(res.status, detail || data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/api/auth/me"),
  login: (email: string, password: string) => request<Me>("POST", "/api/auth/login", { email, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  stats: () => request<Stats>("GET", "/api/stats"),
  deadlines: (days = 14) => request<{ items: Application[] }>("GET", `/api/applications/deadlines?days=${days}`),
  list: (params: URLSearchParams) =>
    request<{ items: Application[]; total: number }>("GET", `/api/applications?${params}`),
  today: () => request<TodayQueue>("GET", "/api/applications/today"),
  get: (id: number) => request<Application & { events: StatusEvent[] }>("GET", `/api/applications/${id}`),
  update: (id: number, changes: Partial<Pick<Application, "status" | "note" | "deadline" | "applied_on">>) =>
    request<Application>("PATCH", `/api/applications/${id}`, changes),
  classify: (text: string) => request<Classification>("POST", "/api/classify", { text }),
};
