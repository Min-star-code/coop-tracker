import { Router } from "express";
import { z } from "zod";
import { requireAgent, sha256 } from "./auth.js";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";
import { SOURCES, STATUSES, type Status } from "./validation.js";
import { CATEGORIES } from "./classifier.js";

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
const dayOrTimestamp = z.union([date, z.iso.datetime({ offset: true })]);
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
    // Written by the daily sort (all optional; older records don't have them).
    category: z.enum(CATEGORIES).optional(),
    brief: z.string().trim().max(1000).optional(),
    location: z.string().trim().max(200).optional(),
    duration: z.string().trim().max(100).optional(),
    applicants: z.number().int().min(0).optional(),
    cl_required: z.boolean().optional(),
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

/** UTC offset of Toronto on a given day, e.g. "-05:00" in winter, "-04:00" in summer. */
function torontoOffset(at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT-05:00"
  return name === "GMT" ? "+00:00" : name.slice(3);
}

/**
 * When the file says this record was last changed. A bare date means the start of that day in
 * Toronto, so a website edit made later the same day counts as newer.
 */
export function fileTime(updatedAt: string): Date {
  if (updatedAt.length > 10) return new Date(updatedAt);
  return new Date(`${updatedAt}T00:00:00${torontoOffset(new Date(`${updatedAt}T12:00:00Z`))}`);
}

/** A timestamp as Toronto local time with offset, e.g. "2026-11-14T11:05:00-05:00". */
export function torontoIso(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${torontoOffset(at)}`;
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Records where the owner's newer website edit (status/note) was kept over the file. */
  keptWebsite: number;
}

type Existing = {
  id: number; ww_job_id: string | null; external_id: string | null; status: Status;
  sync_hash: string | null; applied_on: string | null; web_edited_at: Date | null;
};

/**
 * Upsert every record in one transaction. Rows missing from the file are left alone.
 * Conflict rule (last writer wins): if the owner changed status/note on the website after the
 * file's updated_at, the website's status/note are kept; everything else still comes from the file.
 */
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
    return {
      r, key, hash: fingerprint(r), status: mapped.status, note,
      day: r.updated_at.slice(0, 10), // the local day: date-only, or the date part of a local timestamp
      time: fileTime(r.updated_at),
      source: r.job_id ? "waterlooworks" : r.source!,
    };
  });
  if (problems.length) throw new HttpError(400, `sync rejected: ${problems.slice(0, 20).join("; ")}`);

  return db.transaction(async (tx) => {
    const existing = new Map<string, Existing>();
    const { rows } = await tx.query<Existing>(
      "SELECT id, ww_job_id, external_id, status, sync_hash, applied_on, web_edited_at FROM applications",
    );
    for (const row of rows) existing.set(row.ww_job_id ? `ww:${row.ww_job_id}` : `ext:${row.external_id}`, row);

    const result: SyncResult = { created: 0, updated: 0, unchanged: 0, keptWebsite: 0 };
    for (const p of prepared) {
      const { r } = p;
      const sortFields = [r.category ?? null, r.brief ?? null, r.location ?? null, r.duration ?? null,
        r.applicants ?? null, r.cl_required ?? null];
      const old = existing.get(p.key);
      if (!old) {
        // First time we see this job. If it is already Applied, the file's date is the best
        // date we have for when it was applied.
        const appliedOn = r.applied_on ?? (p.status === "Applied" ? p.day : null);
        const ins = await tx.query<{ id: number }>(
          `INSERT INTO applications
             (source, ww_job_id, external_id, company, title, url, status, applied_on, deadline, note, sync_hash,
              updated_at, category, brief, location, duration, applicants, cover_letter)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::date, $13, $14, $15, $16, $17, $18) RETURNING id`,
          [p.source, r.job_id ?? null, r.external_id ?? null, r.company, r.title, r.url ?? null,
           p.status, appliedOn, r.deadline ?? null, p.note, p.hash, p.day, ...sortFields],
        );
        await tx.query(
          // A bare date would become midnight UTC = the evening before in Toronto. Use noon Toronto time.
          "INSERT INTO status_events (application_id, to_status, changed_at) VALUES ($1, $2, ($3::date + time '12:00') AT TIME ZONE 'America/Toronto')",
          [ins.rows[0].id, p.status, p.day],
        );
        result.created++;
        continue;
      }
      if (old.sync_hash === p.hash) {
        result.unchanged++; // same as last sync: nothing new from the agent
        continue;
      }
      // Compare whole seconds: the file stores edit times to the second, the database to the
      // microsecond, so an exact write-back would otherwise still look "older" by a few ms.
      const webSecond = old.web_edited_at ? Math.floor(new Date(old.web_edited_at).getTime() / 1000) : null;
      const websiteIsNewer = webSecond !== null && Math.floor(p.time.getTime() / 1000) < webSecond;
      if (websiteIsNewer) {
        // Keep the owner's status/note (and the pending flag, so the sync script copies them
        // into the file); take every other field from the file.
        await tx.query(
          `UPDATE applications SET source = $2, company = $3, title = $4, url = $5, deadline = $6, sync_hash = $7,
             category = $8, brief = $9, location = $10, duration = $11, applicants = $12, cover_letter = $13,
             updated_at = now()
           WHERE id = $1`,
          [old.id, p.source, r.company, r.title, r.url ?? null, r.deadline ?? null, p.hash, ...sortFields],
        );
        result.keptWebsite++;
        continue;
      }
      const appliedOn = r.applied_on ?? old.applied_on ?? (p.status === "Applied" ? p.day : null);
      await tx.query(
        `UPDATE applications SET source = $2, company = $3, title = $4, url = $5, status = $6,
           applied_on = $7, deadline = $8, note = $9, sync_hash = $10,
           category = $11, brief = $12, location = $13, duration = $14, applicants = $15, cover_letter = $16,
           web_edited_at = NULL, updated_at = now()
         WHERE id = $1`,
        [old.id, p.source, r.company, r.title, r.url ?? null, p.status, appliedOn, r.deadline ?? null, p.note, p.hash,
         ...sortFields],
      );
      if (old.status !== p.status) {
        await tx.query(
          "INSERT INTO status_events (application_id, from_status, to_status) VALUES ($1, $2, $3)",
          [old.id, old.status, p.status],
        );
      }
      result.updated++;
    }
    return result;
  });
}

/** Website edits the file hasn't caught up with yet, for the sync script to write back. */
export async function pendingWebEdits(db: Db) {
  const { rows } = await db.query<{
    ww_job_id: string | null; external_id: string | null; status: Status; note: string | null; web_edited_at: Date;
  }>(
    `SELECT ww_job_id, external_id, status, note, web_edited_at FROM applications
     WHERE web_edited_at IS NOT NULL ORDER BY web_edited_at`,
  );
  return rows.map((r) => ({
    job_id: r.ww_job_id ?? undefined,
    external_id: r.external_id ?? undefined,
    status: r.status,
    note: r.note,
    edited_at: torontoIso(new Date(r.web_edited_at)),
  }));
}

export function syncRouter(db: Db): Router {
  const r = Router();
  r.use(requireAgent);
  r.post("/", async (req, res) => {
    res.json(await syncApplications(db, req.body));
  });
  r.get("/pending", async (_req, res) => {
    res.json({ items: await pendingWebEdits(db) });
  });
  return r;
}
