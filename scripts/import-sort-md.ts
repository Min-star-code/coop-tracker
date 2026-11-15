/**
 * Copies the details from a daily sort file (project-handoff/CYCLE3_SORT_<date>.md) into the matching
 * applications.json records: category, brief, location, duration, applicants, cl_required, deadline.
 *   npx tsx scripts/import-sort-md.ts <sort.md> [--write]
 * Without --write it only prints what it parsed. Status and updated_at are never changed.
 * Line format: "- **ID** Title｜Company｜Location｜Duration｜N 人｜MM-DD｜CL — brief"
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [mdPath, flag] = process.argv.slice(2);
if (!mdPath) throw new Error("usage: import-sort-md.ts <sort.md> [--write]");
const jsonPath = process.env.APPLICATIONS_JSON ?? path.resolve(here, "../../../applications.json");
const year = (path.basename(mdPath).match(/(\d{4})-\d\d-\d\d/) ?? [])[1] ?? String(new Date().getFullYear());

const SECTION: [RegExp, string][] = [
  [/^## ①/, "citizen_pr"],
  [/^## ②/, "portfolio_design"],
  [/^## ③/, "waterloo"],
  [/^## ④/, "other"],
];

type Parsed = {
  job_id: string; category: string; brief?: string; location?: string; duration?: string;
  applicants?: number; cl_required?: boolean; deadline?: string;
};

export function parseSortMd(md: string, yr: string): Parsed[] {
  const out: Parsed[] = [];
  let category: string | null = null;
  for (const line of md.split("\n")) {
    const sec = SECTION.find(([re]) => re.test(line));
    if (sec) category = sec[1];
    if (!category || !line.startsWith("- ")) continue;
    const text = line.slice(2).replaceAll("**", "").trim();
    const id = text.match(/^(\d{6})\s/)?.[1];
    if (!id) continue; // lines without a leading id are left for manual review
    const [head, ...briefParts] = text.split(" — ");
    // A line that mentions a second job id mixes facts of several jobs (e.g. "57 人 / 496480 … 161 人"),
    // so any number on it could belong to the other job. Skip it rather than record wrong facts.
    if ((head.match(/\b\d{6}\b/g) ?? []).length > 1) continue;
    const parts = head.split("｜").map((p) => p.trim());
    const rec: Parsed = { job_id: id, category };
    if (briefParts.length) rec.brief = briefParts.join(" — ").trim();
    const rest = parts.slice(2); // [0] = "ID title", [1] = company
    for (const p of rest) {
      const applicants = p.match(/(\d+)\s*人/);
      const deadline = p.match(/^(\d{1,2})-(\d{1,2})$/);
      if (applicants) rec.applicants = Number(applicants[1]);
      else if (deadline) rec.deadline = `${yr}-${deadline[1].padStart(2, "0")}-${deadline[2].padStart(2, "0")}`;
      else if (/CL/.test(p)) rec.cl_required = /要\s*CL/.test(p);
      else if (/个月/.test(p)) rec.duration = p;
      else if (!rec.location) rec.location = p;
    }
    out.push(rec);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = parseSortMd(await readFile(mdPath, "utf8"), year);
  const data = JSON.parse(await readFile(jsonPath, "utf8"));
  const byId = new Map<string, Record<string, unknown>>(data.applications.map((r: any) => [r.job_id, r]));
  let matched = 0;
  for (const p of parsed) {
    const rec = byId.get(p.job_id);
    console.log(`${rec ? "ok " : "-- "}${JSON.stringify(p)}`);
    if (!rec) continue;
    matched++;
    const { job_id: _id, ...fields } = p;
    Object.assign(rec, fields);
  }
  console.log(`\nparsed ${parsed.length}, matched ${matched} records in ${path.basename(jsonPath)}`);
  if (flag === "--write") {
    const tmp = `${jsonPath}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, jsonPath);
    console.log("written");
  }
}
