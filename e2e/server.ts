/**
 * Server for Playwright: in-memory database with fixed fixtures, test accounts and a fake LLM.
 * Never touches real data or the Gemini quota.
 */
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";
import { createUser } from "../server/auth.js";
import type { LlmClient } from "../server/classifier.js";
import { openDb } from "../server/db.js";
import { migrate } from "../server/migrate.js";
import { syncApplications } from "../server/sync.js";
import { ACCOUNTS, FIXTURES } from "./fixtures.js";

const db = await openDb();
await migrate(db);
await createUser(db, ACCOUNTS.owner.email, ACCOUNTS.owner.password, "owner");
await createUser(db, ACCOUNTS.viewer.email, ACCOUNTS.viewer.password, "viewer");
await syncApplications(db, { applications: FIXTURES });

const fakeLlm: LlmClient = {
  model: "fake-e2e",
  async generateJson({ user }) {
    const waterloo = /waterloo|kitchener|cambridge/i.test(user);
    return JSON.stringify(
      waterloo
        ? { category: "waterloo", reason: "Location is in the Waterloo region." }
        : { category: "other", reason: "Location is outside the Waterloo region." },
    );
  },
};

const clientDir = fileURLToPath(new URL("../dist/client", import.meta.url));
const port = Number(process.env.PORT ?? 3100);
createApp(db, { llm: fakeLlm, clientDir }).listen(port, () => console.log(`e2e server on ${port}`));
