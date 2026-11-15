/**
 * Local development only: fills ./.pglite with the real applications.json and two test accounts.
 * Passwords are random and written to .dev-credentials.json (gitignored), never printed.
 *   npm run dev:seed
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUser } from "../server/auth.js";
import { openDb } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { syncApplications } from "../server/sync.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = await openDb({ dataDir: path.join(here, "../.pglite") });
await migrate(db);

const creds = {
  owner: { email: "owner@local.test", password: randomBytes(12).toString("base64url") },
  viewer: { email: "viewer@local.test", password: randomBytes(12).toString("base64url") },
};
await db.query("DELETE FROM users WHERE email LIKE '%@local.test'");
await createUser(db, creds.owner.email, creds.owner.password, "owner");
await createUser(db, creds.viewer.email, creds.viewer.password, "viewer");
await writeFile(path.join(here, "../.dev-credentials.json"), JSON.stringify(creds, null, 2));

const file = process.env.APPLICATIONS_JSON ?? path.resolve(here, "../../../applications.json");
console.log("sync:", await syncApplications(db, JSON.parse(await readFile(file, "utf8"))));
console.log("test accounts written to .dev-credentials.json");
await db.close();
