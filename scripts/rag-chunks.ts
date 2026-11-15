/**
 * Chunker for the RAG index: one chunk = one resume bullet, one cover-letter paragraph, or one past
 * posting. Reads PRIVATE workspace files (not in this repo). Used by rag-index.ts and eval-rag.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { focusPosting } from "../server/rag.js";

export const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ws = workspace;
export type Chunk = { source: "outline" | "library" | "posting"; ref: string; text: string; meta?: Record<string, unknown> };
export const CJK = /[㐀-鿿]/;
const clean = (s: string) => s.replace(/`[A-Z]+`/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

export function buildChunks(): Chunk[] {
  const chunks: Chunk[] = [];
// ---- 1. resume bullets
{
  const keep = /^## (PROJECTS|TEAM PROJECT|VOLUNTEER|CROSS-CULTURAL)/;
  let inSection = false;
  let ref = "";
  for (const line of readFileSync(path.join(ws, "resume-update-handoff/MASTER_OUTLINE.md"), "utf8").split("\n")) {
    if (line.startsWith("## ")) { inSection = keep.test(line); ref = line.includes("CROSS-CULTURAL") ? "Background" : ""; continue; }
    if (!inSection) continue;
    if (line.startsWith("### ")) {
      const title = line.slice(4).split("|")[0].split(" — ")[0].trim();
      ref = CJK.test(title) ? (title.includes("Memo Clock") ? "Memo Clock (team project)" : "") : title;
      continue;
    }
    if (ref && line.startsWith("- ") && !CJK.test(line)) {
      const text = clean(line.slice(2));
      if (text.length >= 40) chunks.push({ source: "outline", ref, text });
    }
  }
}

// ---- 2. cover-letter paragraphs
{
  let ref = "";
  let buf: string[] = [];
  const flush = () => {
    const text = clean(buf.join(" "));
    if (ref && text.length >= 40) chunks.push({ source: "library", ref, text });
    buf = [];
  };
  for (const line of readFileSync(path.join(ws, "Cover letter/achievement_library.md"), "utf8").split("\n")) {
    if (line.startsWith("## ") || line.startsWith("### ")) {
      flush();
      // "### B1. LeetReview — <Chinese subtitle>" -> "B1 LeetReview"; section "A" (hook material) -> "Hooks"
      const h = line.replace(/^#+\s*/, "");
      const code = h.match(/^([A-Z]\d?)\./)?.[1] ?? "";
      const name = h.replace(/^[A-Z]\d?\.\s*/, "").split(/[—(（]/)[0].replace(CJK, "").trim();
      ref = code === "A" ? "Hooks" : CJK.test(name) || !name ? code : `${code} ${name}`;
      if (h.includes("⚠️")) ref = ""; // draft paragraphs I haven't approved are never suggested
      continue;
    }
    if (ref === "Hooks") {
      // Hook material: only the ready-made English sentences ("> ...") are chunks.
      if (line.trim().startsWith(">") && !CJK.test(line)) chunks.push({ source: "library", ref, text: clean(line.replace(/^\s*>\s*/, "")) });
      continue;
    }
    if (line.trim() && !CJK.test(line) && !line.startsWith("- ") && !line.startsWith("---")) buf.push(line);
    else if (!line.trim()) flush();
  }
  flush();
}

// ---- 3. past postings and what I did with them
{
  const texts: Record<string, string> = JSON.parse(readFileSync(path.join(ws, "eval-private/classifier/postings.json"), "utf8"));
  const apps = new Map<string, Record<string, unknown>>(
    JSON.parse(readFileSync(path.join(ws, "applications.json"), "utf8")).applications.map((a: Record<string, unknown>) => [String(a.job_id), a]),
  );
  for (const [id, text] of Object.entries(texts)) {
    const a = apps.get(id);
    const title = (text.match(/Job Title:\s*\n?\s*([^\n]+)/)?.[1] ?? (a?.title as string) ?? "").trim();
    chunks.push({
      source: "posting",
      ref: id,
      text: focusPosting(text).slice(0, 4000), // title, summary, duties, skills: what makes two jobs similar
      meta: { title, company: a?.company ?? "", status: a?.status ?? "not tracked" },
    });
  }
}
  return chunks;
}
