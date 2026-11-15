import request from "supertest";
import { createApp } from "../app.js";
import { createApiToken, createUser, resetLoginLimits } from "../auth.js";
import { openDb, type Db } from "../db.js";
import { migrate } from "../migrate.js";

export const OWNER = { email: "owner@example.com", password: "owner-password-1" };
export const VIEWER = { email: "mentor@example.com", password: "viewer-password-1" };

/** Fresh in-memory database + app, an owner, a viewer, and a sync token. */
export async function setup() {
  resetLoginLimits();
  const db = await openDb();
  await migrate(db);
  await createUser(db, OWNER.email, OWNER.password, "owner");
  await createUser(db, VIEWER.email, VIEWER.password, "viewer");
  const token = await createApiToken(db, "test-agent");
  const app = createApp(db);
  return { db, app, token };
}

/** A supertest agent keeps cookies between requests, like a browser. */
export async function login(app: ReturnType<typeof createApp>, who: { email: string; password: string }) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").set("X-Requested-With", "coop-tracker").send(who).expect(200);
  return agent;
}

type Row = {
  source?: string; ww_job_id?: string | null; external_id?: string | null; company?: string; title?: string;
  status?: string; deadline?: string | null; note?: string | null;
};

/** Insert rows directly (the website itself has no create endpoint). */
export async function seed(db: Db, rows: Row[]) {
  const ids: number[] = [];
  for (const r of rows) {
    const { rows: out } = await db.query<{ id: number }>(
      `INSERT INTO applications (source, ww_job_id, external_id, company, title, status, deadline, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [r.source ?? "linkedin", r.ww_job_id ?? null, r.external_id ?? null, r.company ?? "Acme",
       r.title ?? "QA Intern", r.status ?? "Saved", r.deadline ?? null, r.note ?? null],
    );
    await db.query("INSERT INTO status_events (application_id, to_status) VALUES ($1, $2)", [out[0].id, r.status ?? "Saved"]);
    ids.push(out[0].id);
  }
  return ids;
}

export const torontoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
