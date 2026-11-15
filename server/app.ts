import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import type { Db } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { authRouter, csrfGuard, loadPrincipal } from "./auth.js";
import { applicationsRouter, statsRouter } from "./routes/applications.js";
import { syncRouter } from "./sync.js";
import { classifyRouter, type LlmClient } from "./classifier.js";
import { ragRouter, type Embedder } from "./rag.js";

export interface AppOptions {
  /** true in production (HTTPS): cookies are only sent over HTTPS. */
  secureCookies?: boolean;
  /** LLM for /api/classify. Tests pass a fake; production a GeminiClient; undefined = 503. */
  llm?: LlmClient;
  /** Embeddings for the RAG tailoring helper. Tests pass a fake; undefined = 503. */
  embedder?: Embedder;
  /** Built React app (dist/client). Served with an SPA fallback when it exists. */
  clientDir?: string;
}

/**
 * Builds the Express app around a database. Tests pass an in-memory database;
 * index.ts passes the real one and calls listen(). Keeping these apart is what
 * lets supertest call the API without opening a port.
 */
export function createApp(db: Db, opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the host's HTTPS proxy: req.ip is the real client IP
  app.use(cookieParser());
  // The sync sends the whole applications.json (~1,000 rows), so it gets a bigger body limit.
  app.use("/api/sync", express.json({ limit: "5mb" }));
  app.use("/api/rag/chunks", express.json({ limit: "5mb" })); // ~300 past postings + bullets
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api", loadPrincipal(db), csrfGuard);
  app.use("/api/auth", authRouter(db, { secureCookies: opts.secureCookies ?? false }));
  app.use("/api/sync", syncRouter(db));
  app.use("/api/applications", applicationsRouter(db));
  app.use("/api/stats", statsRouter(db));
  app.use("/api/classify", classifyRouter(opts.llm));
  app.use("/api/rag", ragRouter(db, opts.embedder, opts.llm));
  app.use("/api", () => {
    throw new HttpError(404, "no such endpoint");
  });

  // The React app: static files, and index.html for any other non-API path.
  if (opts.clientDir && existsSync(opts.clientDir)) {
    app.use(express.static(opts.clientDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(opts.clientDir!, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
