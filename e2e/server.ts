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
import { indexChunks, type Embedder } from "../server/rag.js";
import { ACCOUNTS, FIXTURES } from "./fixtures.js";

const db = await openDb();
await migrate(db);
await createUser(db, ACCOUNTS.owner.email, ACCOUNTS.owner.password, "owner");
await createUser(db, ACCOUNTS.viewer.email, ACCOUNTS.viewer.password, "viewer");
await syncApplications(db, { applications: FIXTURES });

// Fake embedder: bag-of-words vectors, so texts sharing words are "similar".
const fakeEmbedder: Embedder = {
  model: "fake-embed",
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 64, 0)] += 1;
      const len = Math.hypot(...v) || 1;
      return v.map((x) => x / len);
    });
  },
};
// Sample RAG material (made up for tests; the real index is private).
await indexChunks(db, fakeEmbedder, {
  chunks: [
    { source: "outline", ref: "Sample Project", text: "Wrote 12 Playwright end-to-end tests and ran them in GitHub Actions on every pull request." },
    { source: "library", ref: "Sample Paragraph", text: "I organised a volunteer move-in day and kept every family informed." },
    { source: "posting", ref: "400001", text: "QA co-op writing Playwright tests.", meta: { title: "QA Co-op", company: "Acme", status: "Applied" } },
  ],
});

const fakeLlm: LlmClient = {
  model: "fake-e2e",
  async generateJson({ user, system }) {
    if (system.includes("tailor ONE resume")) {
      // Pick the excerpt about Playwright, if it was retrieved.
      const id = Number(user.match(/<excerpt id="(\d+)" from="Sample Project">/)?.[1] ?? 0);
      return JSON.stringify({ picks: id ? [{ chunk_id: id, requirement: "Playwright tests", why: "12 Playwright tests in CI." }] : [], gaps: [] });
    }
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
createApp(db, { llm: fakeLlm, embedder: fakeEmbedder, clientDir }).listen(port, () => console.log(`e2e server on ${port}`));
