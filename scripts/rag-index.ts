/**
 * Builds the RAG index from my PRIVATE workspace files and uploads it to the site.
 *
 *   npm run rag:index              (uses SYNC_URL / SYNC_TOKEN from .env, like npm run sync)
 *   npm run rag:index -- --dry-run (prints the chunks it would upload, uploads nothing)
 *
 * Chunking: one chunk = one resume bullet, one cover-letter paragraph, or one past posting.
 * A bullet is the unit I actually reuse, so retrieving whole sections would hand the LLM text
 * I'd then have to cut down again.
 *
 * Sources (none of them is in this public repo):
 *   - resume-update-handoff/MASTER_OUTLINE.md: English bullets only (my Chinese notes stay out)
 *   - Cover letter/achievement_library.md: English paragraphs and hook sentences
 *   - eval-private/classifier/postings.json + applications.json: past postings and what I did
 */
import { existsSync } from "node:fs";
import { buildChunks } from "./rag-chunks.js";
import { CachedEmbedder } from "./embed-cache.js";
import { GeminiEmbedder } from "../server/rag.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(here, "../.env"))) process.loadEnvFile(path.join(here, "../.env"));
const dryRun = process.argv.includes("--dry-run");

const chunks = buildChunks();
const count = (s: string) => chunks.filter((c) => c.source === s).length;
console.log(`chunks: outline ${count("outline")}, library ${count("library")}, posting ${count("posting")}`);
if (dryRun) {
  for (const s of ["outline", "library"]) for (const c of chunks.filter((x) => x.source === s).slice(0, 3)) console.log(`  [${s}] ${c.ref}: ${c.text.slice(0, 110)}`);
  const refs = [...new Set(chunks.filter((c) => c.source !== "posting").map((c) => c.ref))];
  console.log(`refs: ${refs.join(" | ")}`);
  process.exit(0);
}

const url = (process.env.SYNC_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = process.env.SYNC_TOKEN;
if (!token) throw new Error("SYNC_TOKEN missing (see npm run cli -- token:create)");
// Embed here (cached; waits out the free per-minute limit), then upload text + vectors.
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY missing");
const embedder = new CachedEmbedder(new GeminiEmbedder(key, undefined, true));
await embedder.load();
const vectors = await embedder.embed(chunks.map((c) => c.text), "document");
const res = await fetch(`${url}/api/rag/chunks`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })), embedding_model: embedder.model }),
  signal: AbortSignal.timeout(180_000), // first index embeds ~400 chunks; the free host may also be waking up
});
console.log(res.status, await res.text());
if (!res.ok) process.exitCode = 1;
