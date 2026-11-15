import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { openDb, type Db } from "../db.js";
import { migrate } from "../migrate.js";
import { createApp } from "../app.js";

let db: Db;
let api: ReturnType<typeof request>;

beforeEach(async () => {
  db = await openDb();
  await migrate(db);
  api = request(createApp(db));
});
afterEach(() => db.close());

const torontoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

const linkedin = { source: "linkedin", company: "Acme", title: "QA Intern", url: "https://acme.example/jobs/1" };

describe("POST /api/applications", () => {
  it("creates an external application, defaults to Saved, records the first event", async () => {
    const res = await api.post("/api/applications").send(linkedin).expect(201);
    expect(res.body).toMatchObject({ ...linkedin, status: "Saved", ww_job_id: null, applied_on: null });

    const detail = await api.get(`/api/applications/${res.body.id}`).expect(200);
    expect(detail.body.events).toMatchObject([{ from_status: null, to_status: "Saved" }]);
  });

  it("fills applied_on with today when created as Applied", async () => {
    const res = await api.post("/api/applications").send({ ...linkedin, status: "Applied" }).expect(201);
    expect(res.body.applied_on).toBe(torontoDay(0));
  });

  it("returns 400 with field errors for bad input", async () => {
    const res = await api
      .post("/api/applications")
      .send({ source: "linkedin", company: "", title: "X", status: "Maybe", url: "javascript:alert(1)" })
      .expect(400);
    const paths = res.body.issues.map((i: { path: string }) => i.path).sort();
    expect(paths).toEqual(["company", "status", "url"]);
  });

  it("refuses a WaterlooWorks job id on a LinkedIn application", async () => {
    await api.post("/api/applications").send({ ...linkedin, ww_job_id: "487008" }).expect(400);
  });

  it("returns 409 for a duplicate WaterlooWorks job id", async () => {
    const ww = { source: "waterlooworks", ww_job_id: "487008", company: "onsemi", title: "SDET" };
    await api.post("/api/applications").send(ww).expect(201);
    await api.post("/api/applications").send(ww).expect(409);
  });

  it("ignores unknown fields such as id or created_at", async () => {
    const res = await api.post("/api/applications").send({ ...linkedin, id: 999, created_at: "2000-01-01" }).expect(201);
    expect(res.body.id).not.toBe(999);
  });

  it("returns 400 for a body that is not JSON", async () => {
    await api.post("/api/applications").set("Content-Type", "application/json").send("{oops").expect(400);
  });
});

describe("PATCH /api/applications/:id", () => {
  it("moves through the workflow and keeps a timeline", async () => {
    const { body } = await api.post("/api/applications").send(linkedin).expect(201);
    const applied = await api.patch(`/api/applications/${body.id}`).send({ status: "Applied" }).expect(200);
    expect(applied.body.applied_on).toBe(torontoDay(0));
    await api.patch(`/api/applications/${body.id}`).send({ status: "Interview", note: "phone screen Tue" }).expect(200);

    const detail = await api.get(`/api/applications/${body.id}`).expect(200);
    expect(detail.body.note).toBe("phone screen Tue");
    expect(detail.body.events.map((e: { to_status: string }) => e.to_status)).toEqual(["Saved", "Applied", "Interview"]);
  });

  it("does not add an event when only the note changes", async () => {
    const { body } = await api.post("/api/applications").send(linkedin).expect(201);
    await api.patch(`/api/applications/${body.id}`).send({ note: "x" }).expect(200);
    const detail = await api.get(`/api/applications/${body.id}`);
    expect(detail.body.events).toHaveLength(1);
  });

  it("can clear an optional field with null", async () => {
    const { body } = await api.post("/api/applications").send({ ...linkedin, deadline: "2026-12-01" }).expect(201);
    const res = await api.patch(`/api/applications/${body.id}`).send({ deadline: null }).expect(200);
    expect(res.body.deadline).toBeNull();
  });

  it("returns 400 for an empty patch and 404 for a missing id", async () => {
    const { body } = await api.post("/api/applications").send(linkedin).expect(201);
    await api.patch(`/api/applications/${body.id}`).send({}).expect(400);
    await api.patch("/api/applications/99999").send({ status: "Applied" }).expect(404);
    await api.patch("/api/applications/abc").send({ status: "Applied" }).expect(404);
  });
});

describe("GET /api/applications (filters)", () => {
  beforeEach(async () => {
    const rows = [
      { source: "waterlooworks", ww_job_id: "1001", company: "Zeta", title: "QA Engineer", status: "Applied" },
      { source: "waterlooworks", ww_job_id: "1002", company: "alpha", title: "Data Analyst", status: "Saved" },
      { source: "linkedin", company: "Beta", title: "Frontend Dev", status: "Saved" },
      { source: "company_site", company: "Gamma 100%", title: "QA Automation", status: "Rejected" },
    ];
    for (const r of rows) await api.post("/api/applications").send(r).expect(201);
  });

  it("filters by several statuses and a source", async () => {
    const res = await api.get("/api/applications?status=Saved,Applied&source=waterlooworks").expect(200);
    expect(res.body.total).toBe(2);
  });

  it("searches company/title case-insensitively and by exact job id", async () => {
    expect((await api.get("/api/applications?q=qa")).body.total).toBe(2);
    expect((await api.get("/api/applications?q=1002")).body.items[0].company).toBe("alpha");
  });

  it("treats % in the search box as a literal character", async () => {
    expect((await api.get("/api/applications?q=100%25")).body.total).toBe(1);
  });

  it("sorts by company ignoring case", async () => {
    const res = await api.get("/api/applications?sort=company");
    expect(res.body.items.map((a: { company: string }) => a.company)).toEqual(["alpha", "Beta", "Gamma 100%", "Zeta"]);
  });

  it("paginates and still reports the full total", async () => {
    const res = await api.get("/api/applications?limit=1&offset=1");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(4);
  });

  it("rejects an unknown status or sort key", async () => {
    await api.get("/api/applications?status=Maybe").expect(400);
    await api.get("/api/applications?sort=id;DROP TABLE users").expect(400);
  });
});

describe("GET /api/applications/deadlines", () => {
  it("lists only Saved jobs due from today to N days ahead, soonest first", async () => {
    const add = (title: string, deadline: string, status = "Saved") =>
      api.post("/api/applications").send({ ...linkedin, title, deadline, status }).expect(201);
    await add("in 5 days", torontoDay(5));
    await add("today", torontoDay(0));
    await add("yesterday", torontoDay(-1));
    await add("in 30 days", torontoDay(30));
    await add("applied already", torontoDay(2), "Applied");

    const res = await api.get("/api/applications/deadlines?days=14").expect(200);
    expect(res.body.items.map((a: { title: string }) => a.title)).toEqual(["today", "in 5 days"]);
  });
});

describe("DELETE and stats", () => {
  it("deletes, then 404s", async () => {
    const { body } = await api.post("/api/applications").send(linkedin).expect(201);
    await api.delete(`/api/applications/${body.id}`).expect(204);
    await api.get(`/api/applications/${body.id}`).expect(404);
    await api.delete(`/api/applications/${body.id}`).expect(404);
  });

  it("counts by status and source", async () => {
    await api.post("/api/applications").send(linkedin);
    await api.post("/api/applications").send({ ...linkedin, status: "Applied" });
    const res = await api.get("/api/stats").expect(200);
    expect(res.body).toEqual({ byStatus: { Saved: 1, Applied: 1 }, bySource: { linkedin: 2 } });
  });

  it("returns JSON 404 for an unknown endpoint", async () => {
    const res = await api.get("/api/nope").expect(404);
    expect(res.body.error).toBe("no such endpoint");
  });
});
