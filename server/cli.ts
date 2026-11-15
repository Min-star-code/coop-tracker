/**
 * Admin commands, run on the machine that can reach the database:
 *   npm run cli -- user:create <email> <owner|viewer>   (asks for the password)
 *   npm run cli -- token:create <name>                  (prints the API token once)
 * There is deliberately no sign-up page: only the owner creates accounts.
 */
import { createInterface } from "node:readline/promises";
import { createApiToken, createUser } from "./auth.js";
import { openDb } from "./db.js";
import { migrate } from "./migrate.js";

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
const db = await openDb(url ? { url } : { dataDir: ".pglite" });
await migrate(db);

try {
  if (cmd === "user:create") {
    const [email, role] = args;
    if (!email || (role !== "owner" && role !== "viewer")) throw new Error("usage: user:create <email> <owner|viewer>");
    const password = process.env.CT_PASSWORD ?? (await ask("Password (min 10 chars): "));
    if (password.length < 10) throw new Error("password must be at least 10 characters");
    await createUser(db, email, password, role);
    console.log(`created ${role} ${email}`);
  } else if (cmd === "token:create") {
    const [name] = args;
    if (!name) throw new Error("usage: token:create <name>");
    console.log(`API token for "${name}" (shown once, store it in .env as SYNC_TOKEN):\n${await createApiToken(db, name)}`);
  } else {
    throw new Error("commands: user:create, token:create");
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.close();
}

async function ask(q: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a;
}
