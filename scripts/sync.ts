/**
 * Pushes applications.json to the website. Run after the AI agent updates the file:
 *   SYNC_URL=https://... SYNC_TOKEN=ct_... npm run sync
 * Optional: APPLICATIONS_JSON=/path/to/applications.json (default: the workspace root file).
 * Safe to run any number of times: unchanged records are skipped by the server.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.APPLICATIONS_JSON ?? path.resolve(here, "../../../applications.json");
const url = process.env.SYNC_URL ?? "http://localhost:3000";
const token = process.env.SYNC_TOKEN;
if (!token) {
  console.error("SYNC_TOKEN is not set (create one with: npm run cli -- token:create agent)");
  process.exit(1);
}

const { applications } = JSON.parse(await readFile(file, "utf8"));
const res = await fetch(`${url}/api/sync`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ applications }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`sync failed (${res.status}):`, body.error ?? body);
  process.exit(1);
}
console.log(`synced ${applications.length} records from ${file}:`, body);
