/** Disk cache for embeddings (private, outside the repo), shared by rag-index.ts and eval-rag.ts. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Embedder } from "../server/rag.js";
import { workspace } from "./rag-chunks.js";

const priv = path.join(workspace, "eval-private/rag");

export /** Wraps the real embedder with a disk cache, so re-running the eval doesn't re-embed 400 chunks. */
class CachedEmbedder implements Embedder {
  model: string;
  private file = path.join(priv, "embeddings.json");
  private cache: Record<string, number[]> = {};
  constructor(private inner: Embedder) { this.model = inner.model; }
  async load() {
    await mkdir(priv, { recursive: true }); if (existsSync(this.file)) this.cache = JSON.parse(await readFile(this.file, "utf8")); }
  async embed(texts: string[], task: "document" | "query") {
    const id = (t: string) => createHash("sha256").update(`${this.model}|${task}|${t}`).digest("hex");
    const missing = texts.filter((t) => !this.cache[id(t)]);
    if (missing.length) {
      const vecs = await this.inner.embed(missing, task);
      missing.forEach((t, i) => (this.cache[id(t)] = vecs[i]));
      await writeFile(this.file, JSON.stringify(this.cache));
    }
    return texts.map((t) => this.cache[id(t)]);
  }
}

