import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { migrate } from "./migrate.js";

const url = process.env.DATABASE_URL;
const db = await openDb(url ? { url } : { dataDir: ".pglite" });
await migrate(db);

const port = Number(process.env.PORT ?? 3000);
createApp(db).listen(port, () => {
  console.log(`coop-tracker API on http://localhost:${port} (${url ? "PostgreSQL" : "PGlite ./.pglite"})`);
});
