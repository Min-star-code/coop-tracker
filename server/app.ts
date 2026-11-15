import express from "express";
import type { Db } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { applicationsRouter, statsRouter } from "./routes/applications.js";

/**
 * Builds the Express app around a database. Tests pass an in-memory database;
 * index.ts passes the real one and calls listen(). Keeping these apart is what
 * lets supertest call the API without opening a port.
 */
export function createApp(db: Db) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/applications", applicationsRouter(db));
  app.use("/api/stats", statsRouter(db));
  app.use("/api", () => {
    throw new HttpError(404, "no such endpoint");
  });

  app.use(errorHandler);
  return app;
}
