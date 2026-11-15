import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

export interface Queryable {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The one thing the rest of the app needs from a database. */
export interface Db extends Queryable {
  /** Run fn on ONE connection inside BEGIN/COMMIT; ROLLBACK if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const DATE_OID = 1082;

/**
 * Production: real PostgreSQL through a connection pool (DATABASE_URL).
 * Local dev and tests: PGlite, which is PostgreSQL compiled to WebAssembly, so the
 * same SQL runs everywhere without installing Postgres or Docker.
 * dataDir undefined = in-memory (each test gets a fresh, empty database).
 *
 * DATE columns come back as plain "YYYY-MM-DD" strings. The default (a JS Date at
 * local midnight) shifts the day when serialised to UTC JSON.
 */
export async function openDb(opts: { url?: string; dataDir?: string } = {}): Promise<Db> {
  if (opts.url) {
    pg.types.setTypeParser(DATE_OID, (v) => v);
    const pool = new pg.Pool({
      connectionString: opts.url,
      ssl: opts.url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
    return {
      query: async (sql, params) => pool.query(sql, params as unknown[]) as any,
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({ query: async (s, p) => client.query(s, p as unknown[]) as any });
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  // Note: new PGlite(undefined, options) silently ignores options; pass one object.
  const lite = new PGlite({ dataDir: opts.dataDir, parsers: { [DATE_OID]: (v: string) => v } });
  return {
    query: async (sql, params) => lite.query(sql, params) as any,
    transaction: (fn) => lite.transaction((tx) => fn({ query: async (s, p) => tx.query(s, p) as any })),
    close: () => lite.close(),
  };
}
