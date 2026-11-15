/**
 * Two-way sync between applications.json and the website. Run after the AI agent updates the file:
 *   SYNC_URL=https://... SYNC_TOKEN=ct_... npm run sync
 * Optional: APPLICATIONS_JSON=/path/to/applications.json (default: the workspace root file).
 *
 * 1. PULL: fetch status/note changes the owner made on the website and write the newer ones into
 *    applications.json (atomically: temp file + rename, so a crash never leaves half a file).
 * 2. PUSH: send the whole file; the server upserts and keeps any newer website edits.
 * Safe to run any number of times.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeWebEdits, type PendingEdit } from "../server/merge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Read SYNC_URL / SYNC_TOKEN from .env if present (variables already set in the shell win).
try {
  process.loadEnvFile(path.join(here, "../.env"));
} catch {
  /* no .env: rely on the shell environment */
}
const file = process.env.APPLICATIONS_JSON ?? path.resolve(here, "../../../applications.json");
const url = (process.env.SYNC_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.SYNC_TOKEN;
if (!token) {
  console.error("SYNC_TOKEN is not set (create one with: npm run cli -- token:create agent)");
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${url}${p}`, {
    method,
    headers: { ...auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000), // a sleeping free-tier host can take ~1 min to wake up
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${p} failed (${res.status}): ${data.error ?? JSON.stringify(data)}`);
  return data;
}

// 1. pull
const raw = await readFile(file, "utf8");
const data = JSON.parse(raw);
const { items } = (await call("GET", "/api/sync/pending")) as { items: PendingEdit[] };
const merged = mergeWebEdits(data, items);
if (merged.written > 0) {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 2)); // same format as before: 2 spaces, no final newline
  await rename(tmp, file);
}
console.log(`pull: ${items.length} website edits, ${merged.written} written to ${path.basename(file)}, ${merged.fileNewer} older than the file`);

// 2. push
const result = await call("POST", "/api/sync", { applications: data.applications });
console.log(`push: ${data.applications.length} records`, result);
