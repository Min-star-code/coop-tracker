import { Router } from "express";
import { z } from "zod";
import { requireAgent, sha256 } from "./auth.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { SOURCES, STATUSES, type Status } from "./validation.js";

/**
 * Statuses the agent writes in applications.json that are not part of the website's workflow.
 * They are folded into the nearest workflow status, and the original wording is kept at the
 * start of the note so nothing is lost.
 */
const LEGACY_STATUS: Record<string, Status> = {
  "Not Selected": "Rejected",
  "Needs Information": "Saved",
  "Cover Letter Required": "Saved",
  "Application Failed": "Saved",
  "Submission Uncertain": "Saved",
};

export function mapStatus(raw: string): { status: Status; legacy: string | null } {
  if ((STATUSES as readonly string[]).includes(raw)) return { status: raw as Status, legacy: null };
  if (raw in LEGACY_STATUS) return { status: LEGACY_STATUS[raw], legacy: raw };
  throw new Error(`unknown status "${raw}"`);
}

const date = z.iso.date();
// Real data: most updated_at values are "2026-10-19", but one batch wrote full local timestamps
// ("2026-10-19T14:43:18-04:00"). The date part of a local-offset timestamp is the local (Toronto) day.
const dayOrTimestamp = z.union([date, z.iso.datetime({ offset: true })]).transform((s) => s.slice(0, 10));
// Real data: 7 skipped jobs were recorded without company/title. Keep them, labelled.
const name = (max: number) =>
  z.string().trim().max(max).transform((s) => s || "(not recorded)");
/** One record of applications.json, as the agent writes it. Extra fields are ignored. */
const record = z
  .object({
    job_id: z.string().regex(/^\d+$/).optional(),
    external_id: z.string().trim().min(1).max(200).optional(),
    source: z.enum(SOURCES).optional(),
    company: name(200),
    title: name(300),
    status: z.string(),
    updated_at: dayOrTimestamp,
    note: z.string().max(5000).optional(),
    url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
    deadline: date.optional(),
    applied_on: date.optional(),
  })
  .refine((r) => Boolean(r.job_id) !== Boolean(r.external_id), {
    message: "exactly one of job_id (WaterlooWorks) or external_id (anything else) is required",
  })
  .refine((r) => !r.external_id || (r.source && r.source !== "waterlooworks"), {
    message: "external records need a non-waterlooworks source",
  });

const syncBody = z.object({ applications: z.array(record).max(10_000) });
type Rec = z.infer<typeof record>;

/** Stable fingerprint: same record content -> same hash, whatever the key order in the file. */
function fingerprint(r: Rec): string {
  const keys = Object.keys(r).sort() as (keyof Rec)[];
  return sha256(JSON.stringify(keys.map((k) => [k, r[k]])));
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
}

/** Upsert every record in one transaction. Rows missing from the file are left alone. */
export async function syncApplications(db: Db, input: unknown): Promise<SyncResult> {
  const { applications } = syncBody.parse(input);

  // Validate everything before touching the database, and report all problems at once.
  const problems: string[] = [];
  const seen = new Set<string>();
  const prepared = applications.map((r, i) => {
    const key = r.job_id ? `ww:${r.job_id}` : `ext:${r.external_id}`;
    if (seen.has(key)) problems.push(`#${i} duplicate ${key}`);
    seen.add(key);
    let mapped: ReturnType<typeof mapStatus> = { status: "Saved", legacy: null };
    try {
      mapped = mapStatus(r.status);
    } catch (e) {
      problems.push(`#${i} ${key}: ${(e as Error).message}`);
    }
    const note = mapped.legacy ? `[WW: ${mapped.legacy}] ${r.note ?? ""}`.trim() : (r.note ?? null);
    return { r, key, hash: fingerprint(r), status: mapped.status, note, source: r.job_id ? "waterlooworks" : r.source! };
  });
  if (problems.length) throw new HttpError(400, `sync rejected: ${problems.slice(0, 20).join("; ")}`);

  return db.transaction(async (tx) => {
    const existing = new Map<string, { id: number; status: Status; sync_hash: string | null; applied_on: string | null }>();
    const { rows } = await tx.query<{
      id: number; ww_job_id: string | null; external_id: string | null;
      status: Status; sync_hash: string | null; applied_on: string | null;
    }>("SELECT id, ww_job_id, external_id, status, sync_hash, applied_on FROM applications");
    for (const row of rows) existing.set(row.ww_job_id ? `ww:${row.ww_job_id}` : `ext:${row.external_id}`, row);

    const result: SyncResult = { created: 0, updated: 0, unchanged: 0 };
    for (const p of prepared) {
      const { r } = p;
      const old = existing.get(p.key);
      if (!old) {
        // First time we see this job. If it is already Applied, the file's updated_at is the best
        // date we have for when it was applied.
        const appliedOn = r.applied_on ?? (p.status === "Applied" ? r.updated_at : null);
        const ins = await tx.query<{ id: number }>(
          `INSERT INTO applications
             (source, ww_job_id, external_id, company, title, url, status, applied_on, deadline, note, sync_hash, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date) RETURNING id`,
          [p.source, r.job_id ?? null, r.external_id ?? null, r.company, r.title, r.url ?? null,
           p.status, appliedOn, r.deadline ?? null, p.note, p.hash, r.updated_at],
        );
        await tx.query(
          "INSERT INTO status_events (application_id, to_status, changed_at) VALUES ($1, $2, $3::date)",
          [ins.rows[0].id, p.status, r.updated_at],
        );
        result.created++;
      } else if (old.sync_hash === p.hash) {
        result.unchanged++; // same as last sync: keep any edits the owner made on the website
      } else {
        const appliedOn = r.applied_on ?? old.applied_on ?? (p.status === "Applied" ? r.updated_at : null);
        await tx.query(
          `UPDATE applications SET source = $2, company = $3, title = $4, url = $5, status = $6,
             applied_on = $7, deadline = $8, note = $9, sync_hash = $10, updated_at = now()
           WHERE id = $1`,
          [old.id, p.source, r.company, r.title, r.url ?? null, p.status, appliedOn, r.deadline ?? null, p.note, p.hash],
        );
        if (old.status !== p.status) {
          await tx.query(
            "INSERT INTO status_events (application_id, from_status, to_status) VALUES ($1, $2, $3)",
            [old.id, old.status, p.status],
          );
        }
        result.updated++;
      }
    }
    return result;
  });
}

export function syncRouter(db: Db): Router {
  const r = Router();
  r.post("/", requireAgent, async (req, res) => {
    res.json(await syncApplications(db, req.body));
  });
  return r;
}
