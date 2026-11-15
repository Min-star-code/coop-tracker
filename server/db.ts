import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

/** The one thing the rest of the app needs from a database. */
export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/**
 * Production: real PostgreSQL through a connection pool (DATABASE_URL).
 * Local dev and tests: PGlite, which is PostgreSQL compiled to WebAssembly, so the
 * same SQL runs everywhere without installing Postgres or Docker.
 * dataDir undefined = in-memory (each test gets a fresh, empty database).
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    const pool = new pg.Pool({
      connectionString: opts.url,
      ssl: opts.url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    return {
      query: async (sql, params) => pool.query(sql, params as unknown[]) as any,
      close: () => pool.end(),
    };
  }
  const lite = new PGlite(opts.dataDir);
  return {
    query: async (sql, params) => lite.query(sql, params) as any,
    close: () => lite.close(),
  };
}
