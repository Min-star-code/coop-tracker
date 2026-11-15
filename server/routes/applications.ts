import { Router } from "express";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { createApplication, deadlineQuery, listQuery, updateApplication } from "../validation.js";

const COLUMNS =
  "id, source, ww_job_id, company, title, url, status, applied_on, deadline, note, created_at, updated_at";

// Whitelisted ORDER BY clauses: user input picks a key, never writes SQL.
const ORDER_BY = {
  updated: "updated_at DESC, id DESC",
  deadline: "deadline ASC NULLS LAST, id",
  company: "lower(company), id",
} as const;

export function applicationsRouter(db: Db): Router {
  const r = Router();

  // GET /api/applications?status=Saved,Applied&source=linkedin&q=qa&sort=deadline&limit=50&offset=0
  r.get("/", async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status?.length) {
      params.push(q.status);
      where.push(`status = ANY($${params.length})`);
    }
    if (q.source?.length) {
      params.push(q.source);
      where.push(`source = ANY($${params.length})`);
    }
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`(company ILIKE $${params.length} OR title ILIKE $${params.length} OR ww_job_id = $${params.length + 1})`);
      params.push(q.q);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM applications ${whereSql}`, params);
    const items = await db.query(
      `SELECT ${COLUMNS} FROM applications ${whereSql} ORDER BY ${ORDER_BY[q.sort]}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );
    res.json({ items: items.rows, total: total.rows[0].n });
  });

  // Saved jobs whose deadline is today or within the next `days` days, soonest first.
  // "Today" is computed in Toronto time, not the database's CURRENT_DATE (UTC on most hosts),
  // otherwise after 7-8 pm Eastern the database already thinks it is tomorrow.
  r.get("/deadlines", async (req, res) => {
    const { days } = deadlineQuery.parse(req.query);
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM applications
       WHERE status = 'Saved' AND deadline BETWEEN $1::date AND $1::date + $2::int
       ORDER BY deadline, id`,
      [today(), days],
    );
    res.json({ items: rows });
  });

  r.get("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const app = await db.query(`SELECT ${COLUMNS} FROM applications WHERE id = $1`, [id]);
    if (!app.rows[0]) throw new HttpError(404, "application not found");
    const events = await db.query(
      "SELECT from_status, to_status, changed_at FROM status_events WHERE application_id = $1 ORDER BY changed_at, id",
      [id],
    );
    res.json({ ...app.rows[0], events: events.rows });
  });

  r.post("/", async (req, res) => {
    const a = createApplication.parse(req.body);
    const appliedOn = a.applied_on ?? (a.status === "Applied" ? today() : null);
    const row = await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number }>(
        `INSERT INTO applications (source, ww_job_id, company, title, url, status, applied_on, deadline, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
        [a.source, a.ww_job_id ?? null, a.company, a.title, a.url ?? null, a.status, appliedOn, a.deadline ?? null, a.note ?? null],
      );
      await tx.query("INSERT INTO status_events (application_id, to_status) VALUES ($1, $2)", [rows[0].id, a.status]);
      return rows[0];
    });
    res.status(201).json(row);
  });

  r.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    const changes = updateApplication.parse(req.body);
    const row = await db.transaction(async (tx) => {
      // FOR UPDATE locks the row so two edits at once can't both record the same status change.
      const before = await tx.query<{ status: string; applied_on: string | null }>(
        "SELECT status, applied_on FROM applications WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!before.rows[0]) throw new HttpError(404, "application not found");
      const old = before.rows[0];
      const statusChanged = changes.status !== undefined && changes.status !== old.status;
      if (statusChanged && changes.status === "Applied" && !old.applied_on && changes.applied_on === undefined) {
        changes.applied_on = today();
      }
      // Column names come from the zod schema keys, not from the request.
      const keys = Object.keys(changes) as (keyof typeof changes)[];
      const set = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const { rows } = await tx.query(
        `UPDATE applications SET ${set}, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, ...keys.map((k) => changes[k] ?? null)],
      );
      if (statusChanged) {
        await tx.query(
          "INSERT INTO status_events (application_id, from_status, to_status) VALUES ($1, $2, $3)",
          [id, old.status, changes.status],
        );
      }
      return rows[0];
    });
    res.json(row);
  });

  r.delete("/:id", async (req, res) => {
    const { rows } = await db.query("DELETE FROM applications WHERE id = $1 RETURNING id", [parseId(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, "application not found");
    res.status(204).end();
  });

  return r;
}

export function statsRouter(db: Db): Router {
  const r = Router();
  r.get("/", async (_req, res) => {
    const byStatus = await db.query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM applications GROUP BY status",
    );
    const bySource = await db.query<{ source: string; n: number }>(
      "SELECT source, count(*)::int AS n FROM applications GROUP BY source",
    );
    res.json({
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
      bySource: Object.fromEntries(bySource.rows.map((r) => [r.source, r.n])),
    });
  });
  return r;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, "application not found");
  return id;
}

/** Today's date in Toronto (where I apply from), as YYYY-MM-DD. */
function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}
