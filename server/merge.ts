import { fileTime } from "./sync.js";

export interface PendingEdit {
  job_id?: string;
  external_id?: string;
  status: string;
  note: string | null;
  edited_at: string; // Toronto local ISO time, e.g. 2026-11-14T11:05:00-05:00
}

type FileRecord = Record<string, unknown> & { job_id?: string; external_id?: string; updated_at: string };

/**
 * Copies website edits into the applications.json data (in place) when the website edit is newer
 * than the record in the file (last writer wins, compared to the second).
 * Returns how many were written and how many were ignored because the file was newer.
 */
export function mergeWebEdits(file: { applications: FileRecord[] }, edits: PendingEdit[]) {
  const byKey = new Map(file.applications.map((r) => [r.job_id ? `ww:${r.job_id}` : `ext:${r.external_id}`, r]));
  let written = 0;
  let fileNewer = 0;
  for (const e of edits) {
    const rec = byKey.get(e.job_id ? `ww:${e.job_id}` : `ext:${e.external_id}`);
    if (!rec) continue; // the website only has rows that came from the file, so this shouldn't happen
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    if (sec(fileTime(rec.updated_at)) > sec(new Date(e.edited_at))) {
      fileNewer++;
      continue;
    }
    rec.status = e.status;
    if (e.note) rec.note = e.note;
    else delete rec.note;
    rec.updated_at = e.edited_at;
    written++;
  }
  return { written, fileNewer };
}
