/**
 * Evaluates the RAG tailoring helper with the REAL Gemini API, on postings where I labelled which
 * of my projects / paragraphs SHOULD be retrieved.
 *
 *   node --env-file=.env --import tsx scripts/eval-rag.ts [--k 8] [--label name]
 *
 * Retrieval: hit rate@k (at least one expected source in the top k) and recall@k (share of the
 * expected sources that appear in the top k).
 * Faithfulness: how many LLM picks the guard had to drop (unretrieved excerpt / invented number),
 * how many "requirement" quotes were not really in the posting, and the full output per posting
 * (saved privately) so I can read every suggestion against its excerpt.
 *
 * Runs on an in-memory database; embeddings are cached in eval-private/rag/ so re-runs cost only
 * the generation calls. Private inputs and outputs stay outside this repo; the summary (job ids,
 * source names, numbers) goes to eval/rag/results.md.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GeminiClient } from "../server/classifier.js";
import { openDb } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { GeminiEmbedder, indexChunks, suggest } from "../server/rag.js";
import { buildChunks, workspace } from "./rag-chunks.js";
import { CachedEmbedder } from "./embed-cache.js";

const k = Number(process.argv[process.argv.indexOf("--k") + 1]) || 8;
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";
const priv = path.join(workspace, "eval-private/rag");
await mkdir(priv, { recursive: true });
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY missing");

const embedder = new CachedEmbedder(new GeminiEmbedder(key, undefined, true));
await embedder.load();
const llm = new GeminiClient(key, process.env.GEMINI_MODEL || undefined);
const db = await openDb();
await migrate(db);
const idx = await indexChunks(db, embedder, { chunks: buildChunks() });
console.log("index:", idx);

type Label = { id: string; kind: string; expected: string[] };
const labels: Label[] = JSON.parse(await readFile(path.join(priv, "labels.json"), "utf8")).postings;
const postings: Record<string, string> = JSON.parse(await readFile(path.join(workspace, "eval-private/classifier/postings.json"), "utf8"));

const rows: string[] = [];
const outputs: Record<string, unknown> = {};
let hits = 0, recallSum = 0, picks = 0, dropped = 0, unverified = 0, pickOnExpected = 0;
for (const l of labels) {
  const out = await suggest(db, embedder, llm, postings[l.id], k);
  outputs[l.id] = out;
  const retrievedRefs = new Set(out.retrieved.map((r) => r.ref));
  const found = l.expected.filter((e) => retrievedRefs.has(e));
  if (found.length) hits++;
  recallSum += found.length / l.expected.length;
  picks += out.picks.length;
  dropped += out.dropped.length;
  unverified += out.picks.filter((p) => !p.quote_verified).length;
  pickOnExpected += out.picks.filter((p) => l.expected.includes(p.ref)).length;
  rows.push(`| ${l.id} | ${l.kind} | ${found.length}/${l.expected.length} | ${out.picks.length} | ${out.dropped.length} | ${out.picks.map((p) => p.ref).join("; ")} |`);
  console.log(`${l.id} ${l.kind}: recall ${found.length}/${l.expected.length}, picks ${out.picks.length}, dropped ${out.dropped.length}`);
  await new Promise((r) => setTimeout(r, 4000)); // stay under the per-minute cap
}
await writeFile(path.join(priv, `outputs-${label}.json`), JSON.stringify(outputs, null, 1));

const n = labels.length;
const pct = (a: number, b: number) => `${b ? ((100 * a) / b).toFixed(1) : "0"}%`;
const report = [
  `# RAG tailoring helper: eval (${label})`,
  "",
  `Models: ${embedder.model} (embeddings, 768 dims), ${llm.model} (generation). k = ${k}. ` +
    `Date: ${new Date().toISOString().slice(0, 10)}. Postings: ${n}. Index: ${idx.added + idx.kept} chunks.`,
  "",
  "## Retrieval (labels: which of my projects / paragraphs should come back)",
  "",
  `- **Hit rate@${k}: ${hits}/${n} (${pct(hits, n)})** postings got at least one expected source in the top ${k}`,
  `- **Recall@${k}: ${pct(recallSum, n)}** of expected sources retrieved, averaged over postings`,
  "",
  "## Faithfulness (generation)",
  "",
  `- Picks shown: ${picks}; picks the guard dropped: **${dropped}** (cited an unretrieved excerpt or a number not in the excerpt/posting)`,
  `- "Requirement" phrases not found word for word in the posting (kept, flagged): ${unverified}/${picks}`,
  `- Picks that are an expected source: ${pickOnExpected}/${picks}`,
  `- Every shown suggestion is the stored text of a retrieved chunk, so a suggestion cannot contain a claim`,
  `  that is not in my own material; only the one-line "why" is model-written, and it is checked for numbers.`,
  "",
  "| posting | kind | expected found | picks | dropped | picked sources |",
  "|---|---|---|---|---|---|",
  ...rows,
];
await mkdir(path.join(workspace, "projects/coop-tracker/eval/rag"), { recursive: true });
const outFile = path.join(workspace, `projects/coop-tracker/eval/rag/results-${label}.md`);
await writeFile(outFile, report.join("\n") + "\n");
console.log(report.slice(4, 15).join("\n"));
await db.close();
