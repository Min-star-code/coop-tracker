import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../db.js";
import { migrate } from "../migrate.js";

let db: Db;
beforeEach(async () => {
  db = await openDb(); // fresh in-memory Postgres for every test
  await migrate(db);
});
afterEach(() => db.close());

const insert = (cols: Record<string, unknown>) => {
  const keys = Object.keys(cols);
  return db.query<{ id: number }>(
    `INSERT INTO applications (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    Object.values(cols),
  );
};

describe("schema", () => {
  it("is idempotent: running migrations twice does nothing the second time", async () => {
    expect(await migrate(db)).toEqual([]);
  });

  it("accepts an external (non-WaterlooWorks) application without a job id", async () => {
    const { rows } = await insert({ source: "linkedin", company: "Acme", title: "QA Intern", status: "Applied" });
    expect(rows[0].id).toBeTypeOf("number");
  });

  it("rejects a status outside the workflow", async () => {
    await expect(insert({ source: "other", company: "A", title: "B", status: "Maybe" })).rejects.toThrow();
  });

  it("rejects a WaterlooWorks job id on a non-WaterlooWorks row", async () => {
    await expect(
      insert({ source: "linkedin", ww_job_id: "123", company: "A", title: "B", status: "Saved" }),
    ).rejects.toThrow();
  });

  it("does not allow the same WaterlooWorks job twice", async () => {
    await insert({ source: "waterlooworks", ww_job_id: "487008", company: "onsemi", title: "SDET", status: "Applied" });
    await expect(
      insert({ source: "waterlooworks", ww_job_id: "487008", company: "onsemi", title: "SDET", status: "Saved" }),
    ).rejects.toThrow();
  });

  it("deleting an application deletes its status history", async () => {
    const { rows } = await insert({ source: "other", company: "A", title: "B", status: "Saved" });
    await db.query("INSERT INTO status_events (application_id, to_status) VALUES ($1, 'Saved')", [rows[0].id]);
    await db.query("DELETE FROM applications WHERE id = $1", [rows[0].id]);
    const left = await db.query("SELECT count(*)::int AS n FROM status_events");
    expect(left.rows[0]).toEqual({ n: 0 });
  });
});
