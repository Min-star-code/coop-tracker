import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Db } from "../db.js";
import { login, OWNER, seed, setup, torontoDay } from "./helpers.js";

let db: Db;
let owner: Awaited<ReturnType<typeof login>>;
const H = { "X-Requested-With": "coop-tracker" };

beforeEach(async () => {
  const s = await setup();
  db = s.db;
  owner = await login(s.app, OWNER);
});
afterEach(() => db.close());

describe("PATCH /api/applications/:id (owner)", () => {
  it("moves through the workflow, fills applied_on, keeps a timeline", async () => {
    const [id] = await seed(db, [{}]);
    const applied = await owner.patch(`/api/applications/${id}`).set(H).send({ status: "Applied" }).expect(200);
    expect(applied.body.applied_on).toBe(torontoDay(0));
    await owner.patch(`/api/applications/${id}`).set(H).send({ status: "Interview", note: "phone screen Tue" }).expect(200);

    const detail = await owner.get(`/api/applications/${id}`).expect(200);
    expect(detail.body.note).toBe("phone screen Tue");
    expect(detail.body.events.map((e: { to_status: string }) => e.to_status)).toEqual(["Saved", "Applied", "Interview"]);
  });

  it("does not add an event when only the note changes", async () => {
    const [id] = await seed(db, [{}]);
    await owner.patch(`/api/applications/${id}`).set(H).send({ note: "x" }).expect(200);
    expect((await owner.get(`/api/applications/${id}`)).body.events).toHaveLength(1);
  });

  it("can clear an optional field with null", async () => {
    const [id] = await seed(db, [{ deadline: "2026-12-01" }]);
    const res = await owner.patch(`/api/applications/${id}`).set(H).send({ deadline: null }).expect(200);
    expect(res.body.deadline).toBeNull();
  });

  it("ignores fields that only the sync agent may set (company, ids)", async () => {
    const [id] = await seed(db, [{ company: "Acme" }]);
    await owner.patch(`/api/applications/${id}`).set(H).send({ company: "Hacked", note: "ok" }).expect(200);
    expect((await owner.get(`/api/applications/${id}`)).body.company).toBe("Acme");
  });

  it("returns 400 for bad or empty input and 404 for a missing id", async () => {
    const [id] = await seed(db, [{}]);
    await owner.patch(`/api/applications/${id}`).set(H).send({}).expect(400);
    await owner.patch(`/api/applications/${id}`).set(H).send({ status: "Maybe" }).expect(400);
    await owner.patch("/api/applications/99999").set(H).send({ status: "Applied" }).expect(404);
    await owner.patch("/api/applications/abc").set(H).send({ status: "Applied" }).expect(404);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const [id] = await seed(db, [{}]);
    await owner.patch(`/api/applications/${id}`).set(H).set("Content-Type", "application/json").send("{oops").expect(400);
  });

  it("has no create or delete endpoint", async () => {
    await owner.post("/api/applications").set(H).send({}).expect(404);
    await owner.delete("/api/applications/1").set(H).expect(404);
  });
});

describe("GET /api/applications (filters)", () => {
  beforeEach(async () => {
    await seed(db, [
      { source: "waterlooworks", ww_job_id: "1001", company: "Zeta", title: "QA Engineer", status: "Applied" },
      { source: "waterlooworks", ww_job_id: "1002", company: "alpha", title: "Data Analyst", status: "Saved" },
      { source: "linkedin", external_id: "li-beta", company: "Beta", title: "Frontend Dev", status: "Saved" },
      { source: "company_site", external_id: "gamma", company: "Gamma 100%", title: "QA Automation", status: "Rejected" },
    ]);
  });

  it("filters by several statuses and a source", async () => {
    const res = await owner.get("/api/applications?status=Saved,Applied&source=waterlooworks").expect(200);
    expect(res.body.total).toBe(2);
  });

  it("searches company/title case-insensitively and by exact job id", async () => {
    expect((await owner.get("/api/applications?q=qa")).body.total).toBe(2);
    expect((await owner.get("/api/applications?q=1002")).body.items[0].company).toBe("alpha");
  });

  it("treats % in the search box as a literal character", async () => {
    expect((await owner.get("/api/applications?q=100%25")).body.total).toBe(1);
  });

  it("sorts by company ignoring case", async () => {
    const res = await owner.get("/api/applications?sort=company");
    expect(res.body.items.map((a: { company: string }) => a.company)).toEqual(["alpha", "Beta", "Gamma 100%", "Zeta"]);
  });

  it("paginates and still reports the full total", async () => {
    const res = await owner.get("/api/applications?limit=1&offset=1");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(4);
  });

  it("rejects an unknown status or sort key", async () => {
    await owner.get("/api/applications?status=Maybe").expect(400);
    await owner.get("/api/applications?sort=id;DROP TABLE users").expect(400);
  });
});

describe("GET /api/applications/deadlines", () => {
  it("lists only Saved jobs due from today to N days ahead, soonest first", async () => {
    await seed(db, [
      { title: "in 5 days", deadline: torontoDay(5) },
      { title: "today", deadline: torontoDay(0) },
      { title: "yesterday", deadline: torontoDay(-1) },
      { title: "in 30 days", deadline: torontoDay(30) },
      { title: "applied already", deadline: torontoDay(2), status: "Applied" },
    ]);
    const res = await owner.get("/api/applications/deadlines?days=14").expect(200);
    expect(res.body.items.map((a: { title: string }) => a.title)).toEqual(["today", "in 5 days"]);
  });
});

describe("stats and unknown endpoints", () => {
  it("counts by status and source", async () => {
    await seed(db, [{}, { status: "Applied" }]);
    const res = await owner.get("/api/stats").expect(200);
    expect(res.body).toEqual({ byStatus: { Saved: 1, Applied: 1 }, bySource: { linkedin: 2 } });
  });

  it("returns JSON 404 for an unknown endpoint", async () => {
    const res = await owner.get("/api/nope").expect(404);
    expect(res.body.error).toBe("no such endpoint");
  });
});
