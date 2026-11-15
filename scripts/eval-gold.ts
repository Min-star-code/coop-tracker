/**
 * Evaluates the classifier on the gold set (141 labelled WaterlooWorks postings) with the REAL Gemini API.
 *
 *   node --env-file=.env --import tsx scripts/eval-gold.ts --prompt v2 --split dev --runs 2
 *
 * - Gold labels and posting texts live in the PRIVATE folder ../../eval-private/classifier
 *   (gold.json, postings.json). Posting text is never written into this public repo.
 * - --split regression: 20 fixed dev postings (5 per category, 6 citizen/PR); exits 1 on any costly
 *   error or accuracy < 90%. `npm run eval:regression` runs it with the production prompt.
 * - --prompt vN reads eval/prompts/vN.txt. --split dev|test: tune on dev only; run test once per
 *   finished prompt, so the test score is not "fitted" to the test postings.
 * - --runs 2 asks the same question twice to measure consistency (temperature is 0, but not
 *   every answer is guaranteed to repeat).
 * - Every answer is cached in eval-private/classifier/runs/, so a stopped run resumes without
 *   repeating calls (the free tier allows 500 requests/day and 15/minute for Flash-Lite).
 * - Writes eval/gold/<prompt>-<split>.md: accuracy, per-category precision/recall, confusion
 *   matrix, the costly error (citizen/PR-only posting marked as open to me), consistency, misses.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, GeminiClient, classify, type Category } from "../server/classifier.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const priv = path.resolve(here, "../../../eval-private/classifier");
const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const promptName = arg("prompt", "v2");
const split = arg("split", "dev");
const runs = Number(arg("runs", "1"));
const system = (await readFile(path.join(here, `../eval/prompts/${promptName}.txt`), "utf8")).trim();

type Gold = { id: string; label: Category; split: string; title: string; regression?: boolean };
const gold: Gold[] = JSON.parse(await readFile(path.join(priv, "gold.json"), "utf8")).cases.filter(
  (c: Gold) => split === "all" || c.split === split || (split === "regression" && c.regression),
);
const texts: Record<string, string> = JSON.parse(await readFile(path.join(priv, "postings.json"), "utf8"));

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error("GEMINI_API_KEY missing");
const llm = new GeminiClient(key, process.env.GEMINI_MODEL || undefined);

type Answer = { got: Category | "error"; reason: string; ms: number };
await mkdir(path.join(priv, "runs"), { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const answers: Record<string, Answer>[] = [];
for (let r = 1; r <= runs; r++) {
  // The regression check always makes fresh calls (it must test today's model, not a cached answer).
  const fresh = split === "regression" ? `-regression-${new Date().toISOString().slice(0, 10)}` : "";
  const file = path.join(priv, "runs", `${promptName}-${llm.model}${fresh}-run${r}.json`);
  const cache: Record<string, Answer> = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
  for (const c of gold) {
    if (cache[c.id] && cache[c.id].got !== "error") continue;
    const t = Date.now();
    let a: Answer;
    try {
      const res = await classify(llm, texts[c.id], system);
      a = { got: res.category, reason: res.reason, ms: Date.now() - t };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 429) {
        console.log("429: quota reached, stopping. Re-run later; finished answers are cached.");
        await writeFile(file, JSON.stringify(cache, null, 1));
        process.exit(2);
      }
      a = { got: "error", reason: (e as Error).message.slice(0, 200), ms: Date.now() - t };
    }
    cache[c.id] = a;
    await writeFile(file, JSON.stringify(cache, null, 1)); // save after every call
    console.log(`run${r} ${a.got === c.label ? "ok  " : "MISS"} ${c.id} expected=${c.label} got=${a.got} (${a.ms} ms)`);
    await sleep(5000); // about 12 requests a minute, under the 15/minute cap
  }
  answers.push(cache);
}

// ---------- metrics (run 1 is the scored run; run 2 only measures consistency) ----------
const first = answers[0];
const n = gold.length;
const correct = gold.filter((c) => first[c.id]?.got === c.label).length;
const cols = [...CATEGORIES, "error"] as const;
const confusion = Object.fromEntries(CATEGORIES.map((e) => [e, Object.fromEntries(cols.map((g) => [g, 0]))]));
for (const c of gold) confusion[c.label][first[c.id].got]++;
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const perClass = CATEGORIES.map((cat) => {
  const tp = gold.filter((c) => c.label === cat && first[c.id].got === cat).length;
  const predicted = gold.filter((c) => first[c.id].got === cat).length;
  const actual = gold.filter((c) => c.label === cat).length;
  return { cat, tp, predicted, actual, precision: pct(tp, predicted), recall: pct(tp, actual) };
});
// The costly error: a citizen/PR-only posting sorted as something I could apply to. I would waste
// an application (or worse, answer a prescreen dishonestly). The opposite error only hides a job.
const pr = gold.filter((c) => c.label === "citizen_pr");
const costly = pr.filter((c) => first[c.id].got !== "citizen_pr");
const falsePr = gold.filter((c) => c.label !== "citizen_pr" && first[c.id].got === "citizen_pr");
const consistency =
  runs > 1 ? gold.filter((c) => answers.every((a) => a[c.id]?.got === first[c.id].got)) : undefined;
const latencies = gold.map((c) => first[c.id].ms).sort((a, b) => a - b);

const lines = [
  `# Classifier eval: prompt ${promptName}, ${split} split`,
  "",
  `Model: ${llm.model}. Date: ${new Date().toISOString().slice(0, 10)}. Postings: ${n}.`,
  "",
  `- **Accuracy: ${correct}/${n} (${pct(correct, n)})**`,
  `- **Costly error** (citizen/PR-only posting marked as open to me): **${costly.length}/${pr.length}** ` +
    `citizen/PR postings missed`,
  `- Opposite error (open posting marked citizen/PR-only, so I would skip it): ${falsePr.length}`,
  consistency
    ? `- Consistency: ${consistency.length}/${n} (${pct(consistency.length, n)}) postings got the same answer in all ${runs} runs`
    : "- Consistency: not measured (1 run)",
  `- Median latency: ${latencies[Math.floor(n / 2)]} ms`,
  "",
  "## Per category",
  "",
  "| category | precision | recall | correct / predicted / actual |",
  "|---|---|---|---|",
  ...perClass.map((p) => `| ${p.cat} | ${p.precision} | ${p.recall} | ${p.tp} / ${p.predicted} / ${p.actual} |`),
  "",
  "Precision: of the postings the model put in this category, how many really belong there.",
  "Recall: of the postings that really belong in this category, how many the model found.",
  "",
  "## Confusion matrix (rows = correct label, columns = model's answer)",
  "",
  `| label \\ answer | ${cols.join(" | ")} |`,
  `|---|${cols.map(() => "---").join("|")}|`,
  ...CATEGORIES.map((e) => `| ${e} | ${cols.map((g) => confusion[e][g]).join(" | ")} |`),
  "",
  "## Misses",
  "",
  "| id | label | answer | model's reason |",
  "|---|---|---|---|",
  ...gold
    .filter((c) => first[c.id].got !== c.label)
    .map((c) => `| ${c.id} | ${c.label} | ${first[c.id].got} | ${first[c.id].reason.replaceAll("|", "/")} |`),
];
if (consistency && consistency.length < n) {
  lines.push("", "## Inconsistent answers", "", "| id | label | answers |", "|---|---|---|");
  for (const c of gold.filter((g) => !consistency.includes(g)))
    lines.push(`| ${c.id} | ${c.label} | ${answers.map((a) => a[c.id].got).join(", ")} |`);
}
await mkdir(path.join(here, "../eval/gold"), { recursive: true });
const out = path.join(here, `../eval/gold/${promptName}-${split}.md`);
await writeFile(out, lines.join("\n") + "\n");
console.log(lines.slice(0, 10).join("\n"));
console.log(`\nwrote ${path.relative(process.cwd(), out)}`);

// Regression gate (20 fixed dev postings): run after every prompt change, before deploying it.
// Fails on ANY costly error or accuracy under 90%.
if (split === "regression") {
  const ok = costly.length === 0 && correct / n >= 0.9;
  console.log(ok ? "REGRESSION PASS" : "REGRESSION FAIL");
  if (!ok) process.exitCode = 1;
}
