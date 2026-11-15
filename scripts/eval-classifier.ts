/**
 * Measures the classifier against labelled postings (eval/cases.json) with the REAL Gemini API.
 *   node --env-file=.env --import tsx scripts/eval-classifier.ts [label-for-report]
 * Posting texts are read from the workspace (outside this repo) and never committed.
 * Writes eval/results-<label>.md with accuracy, a confusion table and every miss.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, GeminiClient, classify, type Category } from "../server/classifier.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../../..");
const spec = JSON.parse(await readFile(path.join(here, "../eval/cases.json"), "utf8"));
const label = process.argv[2] ?? "run";

// Split saved posting files into {job id -> text}.
const texts = new Map<string, string>();
for (const src of spec.sources as string[]) {
  const s = await readFile(path.join(workspace, src), "utf8");
  const parts = s.split(/=+\nJOB ID (\d+)\n=+\n/);
  if (parts.length > 1) for (let i = 1; i < parts.length; i += 2) texts.set(parts[i], parts[i + 1]);
  else texts.set(src.match(/(\d{6})/)![1], s);
}

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("GEMINI_API_KEY missing");
const llm = new GeminiClient(key, process.env.GEMINI_MODEL || undefined);

type Row = { id: string; label: Category; got: Category | "error"; reason: string; ms: number; synthetic: boolean; ambiguous: boolean };
const rows: Row[] = [];
const all = [
  ...spec.cases.map((c: any) => ({ ...c, text: texts.get(c.id), synthetic: false })),
  ...spec.synthetic.map((c: any) => ({ ...c, synthetic: true })),
];
for (const c of all) {
  if (!c.text) throw new Error(`no posting text for ${c.id}`);
  const base = { id: c.id, label: c.label, synthetic: c.synthetic, ambiguous: Boolean(c.ambiguous) };
  let t = Date.now();
  for (let attempt = 1; ; attempt++) {
    t = Date.now();
    try {
      const r = await classify(llm, c.text);
      rows.push({ ...base, got: r.category, reason: r.reason, ms: Date.now() - t });
      break;
    } catch (e) {
      // Free tier has a requests-per-minute cap: on 429 wait 30 s and try once more.
      if ((e as { status?: number }).status === 429 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      rows.push({ ...base, got: "error", reason: (e as Error).message, ms: Date.now() - t });
      break;
    }
  }
  const last = rows[rows.length - 1];
  console.log(`${last.got === last.label ? "ok  " : "MISS"} ${c.id} expected=${c.label} got=${last.got} (${last.ms} ms)`);
  await new Promise((r) => setTimeout(r, 7000)); // stay under free-tier requests-per-minute
}

const score = (rs: Row[]) => `${rs.filter((r) => r.got === r.label).length}/${rs.length}`;
const real = rows.filter((r) => !r.synthetic && !r.ambiguous);
const ambiguous = rows.filter((r) => r.ambiguous);
const cols = [...CATEGORIES, "error"] as const;
const confusion = CATEGORIES.map(
  (exp) => `| ${exp} | ${cols.map((g) => real.filter((r) => r.label === exp && r.got === g).length).join(" | ")} |`,
);
const md = [
  `# Classifier eval — ${label}`,
  ``,
  `Model: ${llm.model}. Date: ${new Date().toISOString().slice(0, 10)}.`,
  ``,
  `- Real postings: **${score(real)}** correct`,
  `- Ambiguous (not scored): ${ambiguous.map((r) => `${r.id} -> ${r.got}`).join(", ") || "none"}`,
  `- Synthetic edge cases: **${score(rows.filter((r) => r.synthetic))}** correct`,
  `- Median latency: ${[...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)].ms} ms`,
  ``,
  `Confusion (real postings; rows = expected, columns = got):`,
  ``,
  `| expected \\ got | ${cols.join(" | ")} |`,
  `|---|${cols.map(() => "---").join("|")}|`,
  ...confusion,
  ``,
  `## Every answer`,
  ``,
  `| id | expected | got | model's reason |`,
  `|---|---|---|---|`,
  ...rows.map((r) => `| ${r.id}${r.ambiguous ? " (ambiguous)" : ""} | ${r.label} | ${r.got === r.label ? r.got : `**${r.got}**`} | ${r.reason.replaceAll("|", "/")} |`),
  ``,
].join("\n");
await writeFile(path.join(here, `../eval/results-${label}.md`), md);
console.log(`\nreal ${score(real)} (ambiguous not scored: ${ambiguous.length}), synthetic ${score(rows.filter((r) => r.synthetic))} -> eval/results-${label}.md`);
