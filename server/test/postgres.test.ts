/**
 * Runs only when TEST_DATABASE_URL points at a real PostgreSQL (CI does this). Checks the code that
 * PGlite can't exercise: the pg connection pool, transactions on a pooled client, DATE parsing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openDb, type Db } from "../db.js";
import { migrate } from "../migrate.js";
import { syncApplications } from "../sync.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("real PostgreSQL", () => {
  let db: Db;
  beforeAll(async () => {
    db = await openDb({ url });
    await db.query("DROP SCHEMA public CASCADE");
    await db.query("CREATE SCHEMA public");
    await migrate(db);
  });
  afterAll(() => db?.close());

  it("migrations are idempotent", async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it("a failed transaction rolls back on the same pooled connection", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO applications (source, company, title, status) VALUES ('other', 'A', 'B', 'Saved')",
        );
        await tx.query("INSERT INTO applications (source, company, title, status) VALUES ('other', 'A', 'B', 'Maybe')");
      }),
    ).rejects.toThrow();
    const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM applications");
    expect(rows[0].n).toBe(0);
  });

  it("sync works and DATE columns come back as YYYY-MM-DD strings", async () => {
    const r = await syncApplications(db, {
      applications: [{ job_id: "1", company: "A", title: "QA", status: "Applied", updated_at: "2026-11-13", deadline: "2026-11-20" }],
    });
    expect(r.created).toBe(1);
    const { rows } = await db.query("SELECT applied_on, deadline FROM applications");
    expect(rows[0]).toEqual({ applied_on: "2026-11-13", deadline: "2026-11-20" });
  });

  it("REAL[] embeddings round-trip as numbers (RAG index)", async () => {
    await db.query(
      "INSERT INTO rag_chunks (source, ref, text, hash, embedding) VALUES ('outline', 'r', 'some text here', 'h1', $1)",
      [[0.25, -0.5, 1]],
    );
    const { rows } = await db.query<{ embedding: number[] }>("SELECT embedding FROM rag_chunks WHERE hash = 'h1'");
    expect(rows[0].embedding.map(Number)).toEqual([0.25, -0.5, 1]);
  });
});
