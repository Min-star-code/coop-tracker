import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { migrate } from "./migrate.js";
import { GeminiClient } from "./classifier.js";
import { GeminiEmbedder } from "./rag.js";

const url = process.env.DATABASE_URL;
const db = await openDb(url ? { url } : { dataDir: fileURLToPath(new URL("../.pglite", import.meta.url)) });
await migrate(db);

const port = Number(process.env.PORT ?? 3000);
// trim(): a key pasted into a dashboard often brings a trailing space or newline with it.
const key = process.env.GEMINI_API_KEY?.trim();
const llm = key ? new GeminiClient(key, process.env.GEMINI_MODEL || undefined) : undefined;
const embedder = key ? new GeminiEmbedder(key) : undefined;
// Which key is loaded, without revealing it: length + first 8 hex chars of its SHA-256.
// Lets me compare the dashboard value with my local .env when the API says "key not valid".
if (key) console.log(`Gemini key loaded: ${key.length} chars, sha256 ${createHash("sha256").update(key).digest("hex").slice(0, 8)}`);
// fileURLToPath, not URL.pathname: the latter keeps "%20" for the space in "Waterloo Work".
const clientDir = fileURLToPath(new URL("../dist/client", import.meta.url));
createApp(db, { secureCookies: process.env.NODE_ENV === "production", llm, embedder, clientDir }).listen(port, () => {
  console.log(`coop-tracker API on http://localhost:${port} (${url ? "PostgreSQL" : "PGlite ./.pglite"})`);
});
