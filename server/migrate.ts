import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Db } from "./db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Runs every migrations/*.sql file that has not run yet, in file-name order.
 * The schema_migrations table remembers which ones ran, so this is safe to call
 * on every server start. Each file runs inside a transaction: all or nothing.
 */
export async function migrate(db: Db): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await db.query("BEGIN");
    try {
      for (const stmt of splitSql(sql)) await db.query(stmt);
      await db.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
    ran.push(file);
  }
  return ran;
}

/** Split a .sql file into statements (our migrations have no ';' inside strings). */
function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { openDb } = await import("./db.js");
  const url = process.env.DATABASE_URL;
  const db = await openDb(url ? { url } : { dataDir: ".pglite" });
  console.log("ran:", await migrate(db));
  await db.close();
}
