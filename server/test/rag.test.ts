import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import type { LlmClient } from "../classifier.js";
import type { Db } from "../db.js";
import { cosine, guard, topK, type Chunk, type Embedder } from "../rag.js";
import { login, OWNER, setup, VIEWER } from "./helpers.js";

const H = { "X-Requested-With": "coop-tracker" };

/** Fake embedder: a bag-of-words vector (each word hashed into one of 64 slots), normalised.
 *  Texts that share words get similar vectors, which is all retrieval tests need. */
class FakeEmbedder implements Embedder {
  model = "fake-embed";
  calls = 0;
  texts = 0;
  async embed(texts: string[]) {
    this.calls++;
    this.texts += texts.length;
    return texts.map((t) => {
      const v = new Array(64).fill(0);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64;
        v[h] += 1;
      }
      const len = Math.hypot(...v) || 1;
      return v.map((x) => x / len);
    });
  }
}

class FakeLlm implements LlmClient {
  model = "fake-model";
  calls: { system: string; user: string }[] = [];
  constructor(private answers: (string | ((user: string) => string))[]) {}
  async generateJson(req: { system: string; user: string }) {
    this.calls.push(req);
    const a = this.answers.shift() ?? "";
    return typeof a === "function" ? a(req.user) : a;
  }
}

const CHUNKS = [
  { source: "outline", ref: "Memory Map", text: "Added 15 Playwright end-to-end tests and set up GitHub Actions to run them on every pull request." },
  { source: "outline", ref: "LeetReview", text: "Wrote 23 pytest tests with a fake LLM client covering the tools and the loop limit." },
  { source: "library", ref: "D2 UWaterloo Life", text: "Analysed 30 Instagram posts to see which content formats drew the most engagement." },
  { source: "posting", ref: "490000", text: "QA automation co-op writing Playwright tests in a CI pipeline.", meta: { title: "QA Co-op", status: "Applied" } },
];
const POSTING = "Software QA co-op. You will write Playwright end-to-end tests and keep the GitHub Actions CI pipeline green. Python and pytest are a plus.";

let db: Db | undefined;
afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function app(llm?: LlmClient, embedder: Embedder = new FakeEmbedder()) {
  const s = await setup();
  db = s.db;
  return { app: createApp(s.db, { llm, embedder }), token: s.token, embedder };
}
const index = (a: ReturnType<typeof createApp>, token: string, chunks: unknown[]) =>
  request(a).post("/api/rag/chunks").set("Authorization", `Bearer ${token}`).send({ chunks });

describe("indexing", () => {
  it("embeds new chunks, keeps unchanged ones, removes deleted ones", async () => {
    const embedder = new FakeEmbedder();
    const { app: a, token } = await app(undefined, embedder);
    expect((await index(a, token, CHUNKS).expect(200)).body).toEqual({ added: 4, removed: 0, kept: 0 });
    // Same chunks again: nothing to embed (no API calls wasted).
    expect((await index(a, token, CHUNKS).expect(200)).body).toEqual({ added: 0, removed: 0, kept: 4 });
    // One edited, one removed: one new embedding, two old rows gone.
    const edited = [{ ...CHUNKS[0], text: CHUNKS[0].text + " Also ran them on a 390 px phone." }, CHUNKS[1], CHUNKS[2]];
    expect((await index(a, token, edited).expect(200)).body).toEqual({ added: 1, removed: 2, kept: 2 });
    expect(embedder.texts).toBe(5);
  });

  it("stores vectors the index script computed, without calling the embedder; rejects another model's vectors", async () => {
    const embedder = new FakeEmbedder();
    const { app: a, token } = await app(undefined, embedder);
    const v = new Array(768).fill(0).map((_, i) => (i === 0 ? 2 : 0));
    const chunk = { ...CHUNKS[0], embedding: v };
    await request(a).post("/api/rag/chunks").set("Authorization", `Bearer ${token}`)
      .send({ chunks: [chunk], embedding_model: "some-other-model" }).expect(400);
    const res = await request(a).post("/api/rag/chunks").set("Authorization", `Bearer ${token}`)
      .send({ chunks: [chunk], embedding_model: "fake-embed" }).expect(200);
    expect(res.body.added).toBe(1);
    expect(embedder.calls).toBe(0);
    const { rows } = await db!.query<{ embedding: number[] }>("SELECT embedding FROM rag_chunks");
    expect(rows[0].embedding[0]).toBe(1); // normalised to unit length
  });

  it("only the sync agent's token can upload; a signed-in owner cannot", async () => {
    const { app: a } = await app();
    const owner = await login(a, OWNER);
    await owner.post("/api/rag/chunks").set(H).send({ chunks: CHUNKS }).expect(401);
  });
});

describe("POST /api/rag/suggest", () => {
  it("returns stored chunk text for each pick, the similar past posting, and the gaps", async () => {
    const llm = new FakeLlm([
      (user) => {
        const id = Number(user.match(/<excerpt id="(\d+)" from="Memory Map">/)![1]);
        return JSON.stringify({
          picks: [{ chunk_id: id, requirement: "write Playwright end-to-end tests", why: "15 Playwright tests in CI match this." }],
          gaps: ["Python and pytest are a plus", "Kubernetes"],
        });
      },
    ]);
    const { app: a, token } = await app(llm);
    await index(a, token, CHUNKS).expect(200);
    const owner = await login(a, OWNER);
    const res = await owner.post("/api/rag/suggest").set(H).send({ text: POSTING }).expect(200);
    expect(res.body.picks).toHaveLength(1);
    expect(res.body.picks[0]).toMatchObject({ ref: "Memory Map", text: CHUNKS[0].text, quote_verified: true });
    expect(res.body.similar[0]).toMatchObject({ ref: "490000", title: "QA Co-op", status: "Applied" });
    // "Kubernetes" is not in the posting, so it is not reported as a gap.
    expect(res.body.gaps).toEqual(["Python and pytest are a plus"]);
    // Past postings are never sent to the LLM as material, only bullets / paragraphs.
    expect(llm.calls[0].user).not.toContain("QA automation co-op writing");
  });

  it("drops picks that cite an unretrieved chunk or invent a number", async () => {
    const llm = new FakeLlm([
      (user) => {
        const id = Number(user.match(/<excerpt id="(\d+)" from="Memory Map">/)![1]);
        return JSON.stringify({
          picks: [
            { chunk_id: 9999, requirement: "CI", why: "Made up." },
            { chunk_id: id, requirement: "Playwright", why: "Wrote 40 Playwright tests." },
          ],
          gaps: [],
        });
      },
    ]);
    const { app: a, token } = await app(llm);
    await index(a, token, CHUNKS).expect(200);
    const owner = await login(a, OWNER);
    const res = await owner.post("/api/rag/suggest").set(H).send({ text: POSTING }).expect(200);
    expect(res.body.picks).toEqual([]);
    expect(res.body.dropped.map((d: { reason: string }) => d.reason)).toEqual([
      "cited an excerpt that was not retrieved",
      "number not in the excerpt or posting: 40",
    ]);
  });

  it("is owner-only: a viewer gets 403, signed-out gets 401", async () => {
    const { app: a, token } = await app(new FakeLlm([]));
    await index(a, token, CHUNKS).expect(200);
    const viewer = await login(a, VIEWER);
    await viewer.post("/api/rag/suggest").set(H).send({ text: POSTING }).expect(403);
    await viewer.get("/api/rag/stats").expect(403);
    await request(a).post("/api/rag/suggest").set(H).send({ text: POSTING }).expect(401);
  });

  it("explains an empty index instead of calling the LLM", async () => {
    const llm = new FakeLlm([]);
    const { app: a } = await app(llm);
    const owner = await login(a, OWNER);
    await owner.post("/api/rag/suggest").set(H).send({ text: POSTING }).expect(409);
    expect(llm.calls).toHaveLength(0);
  });
});

describe("retrieval and guard helpers", () => {
  const c = (id: number, source: Chunk["source"], embedding: number[]): Chunk => ({ id, source, ref: `r${id}`, text: `chunk ${id}`, meta: {}, embedding });
  it("topK ranks by cosine and filters by source", () => {
    const chunks = [c(1, "outline", [1, 0]), c(2, "outline", [0.6, 0.8]), c(3, "posting", [1, 0])];
    expect(topK([1, 0], chunks, ["outline"], 2).map((h) => h.chunk.id)).toEqual([1, 2]);
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it("flags a requirement that is not a real quote from the posting, but keeps the pick", () => {
    const hit = { chunk: c(1, "outline", [1, 0]), score: 1 };
    const out = guard({ picks: [{ chunk_id: 1, requirement: "loves teamwork", why: "ok" }], gaps: [] }, [hit], "We need Playwright.");
    expect(out.kept[0].quoteVerified).toBe(false);
  });
});

describe("focusPosting and per-source cap", () => {
  it("keeps only title, summary, duties and skills of a WaterlooWorks posting", async () => {
    const { focusPosting } = await import("../rag.js");
    const ww = "Work Term:\n2027 - Winter\nJob Title:\nQA Co-op\nJob - City:\nToronto\nJob Summary:\nTest our app.\n" +
      "Job Responsibilities:\nWrite Playwright tests.\nRequired Skills:\nTypeScript\nCompensation and Benefits:\n$25/h\nApplication Method:\nOnline";
    expect(focusPosting(ww)).toBe("QA Co-op\nTest our app.\nWrite Playwright tests.\nTypeScript");
    expect(focusPosting("A plain posting with no headings.")).toBe("A plain posting with no headings.");
  });
  it("topK never returns more than perRef chunks from one source", () => {
    const mk = (id: number, ref: string, x: number): Chunk => ({ id, source: "outline", ref, text: "t", meta: {}, embedding: [x, Math.sqrt(1 - x * x)] });
    const chunks = [mk(1, "A", 1), mk(2, "A", 0.99), mk(3, "A", 0.98), mk(4, "B", 0.5)];
    expect(topK([1, 0], chunks, ["outline"], 3, 2).map((h) => h.chunk.id)).toEqual([1, 2, 4]);
  });
});
