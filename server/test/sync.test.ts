import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Db } from "../db.js";
import { mapStatus } from "../sync.js";
import { login, OWNER, setup } from "./helpers.js";

let db: Db;
let app: Awaited<ReturnType<typeof setup>>["app"];
let token: string;
const H = { "X-Requested-With": "coop-tracker" };

beforeEach(async () => {
  ({ db, app, token } = await setup());
});
afterEach(() => db.close());

const sync = (applications: unknown[]) =>
  request(app).post("/api/sync").set("Authorization", `Bearer ${token}`).send({ applications });

const ww = (over: Record<string, unknown> = {}) => ({
  job_id: "487008", company: "onsemi", title: "Software Developer in Test",
  status: "Applied", updated_at: "2026-09-19", ...over,
});

describe("mapStatus", () => {
  it("keeps workflow statuses and folds legacy ones", () => {
    expect(mapStatus("Applied")).toEqual({ status: "Applied", legacy: null });
    expect(mapStatus("Not Selected")).toEqual({ status: "Rejected", legacy: "Not Selected" });
    expect(mapStatus("Cover Letter Required")).toEqual({ status: "Saved", legacy: "Cover Letter Required" });
    expect(() => mapStatus("Whatever")).toThrow();
  });
});

describe("POST /api/sync", () => {
  it("creates new rows; Applied rows get applied_on from updated_at", async () => {
    const res = await sync([ww(), ww({ job_id: "1", status: "Saved" })]).expect(200);
    expect(res.body).toEqual({ created: 2, updated: 0, unchanged: 0 });
    const { rows } = await db.query("SELECT applied_on FROM applications WHERE ww_job_id = '487008'");
    expect(rows[0].applied_on).toBe("2026-09-19");
  });

  it("is idempotent: the same file twice changes nothing", async () => {
    await sync([ww()]).expect(200);
    expect((await sync([ww()])).body).toEqual({ created: 0, updated: 0, unchanged: 1 });
  });

  it("an agent status change updates the row and adds a timeline event", async () => {
    await sync([ww({ status: "Saved" })]);
    expect((await sync([ww({ status: "Applied", updated_at: "2026-11-13" })])).body.updated).toBe(1);
    const { rows } = await db.query("SELECT from_status, to_status FROM status_events ORDER BY id");
    expect(rows).toEqual([
      { from_status: null, to_status: "Saved" },
      { from_status: "Saved", to_status: "Applied" },
    ]);
  });

  it("keeps the owner's website edit until the agent changes that record", async () => {
    await sync([ww()]);
    const owner = await login(app, OWNER);
    const { body } = await owner.get("/api/applications?q=487008");
    await owner.patch(`/api/applications/${body.items[0].id}`).set(H).send({ status: "Interview" }).expect(200);

    await sync([ww()]); // same record again: owner's Interview stays
    let row = (await db.query("SELECT status FROM applications")).rows[0];
    expect(row.status).toBe("Interview");

    await sync([ww({ status: "Not Selected", updated_at: "2026-12-01" })]); // agent has news: it wins
    row = (await db.query("SELECT status, note FROM applications")).rows[0];
    expect(row).toEqual({ status: "Rejected", note: "[WW: Not Selected]" });
  });

  it("supports external applications keyed by external_id", async () => {
    await sync([{ external_id: "linkedin-acme-qa", source: "linkedin", company: "Acme", title: "QA",
                  status: "Applied", updated_at: "2026-11-10", url: "https://acme.example/jobs/1" }]).expect(200);
    const { rows } = await db.query("SELECT source, ww_job_id, external_id FROM applications");
    expect(rows[0]).toEqual({ source: "linkedin", ww_job_id: null, external_id: "linkedin-acme-qa" });
  });

  it("rejects the whole file (and writes nothing) if any record is bad", async () => {
    const res = await sync([ww(), ww({ job_id: "2", status: "Whatever" }), ww()]).expect(400);
    expect(res.body.error).toMatch(/unknown status "Whatever"/);
    expect(res.body.error).toMatch(/duplicate ww:487008/);
    expect((await db.query("SELECT count(*)::int AS n FROM applications")).rows[0].n).toBe(0);
  });

  it("rejects a record with both or neither id", async () => {
    await sync([ww({ external_id: "x", source: "linkedin" })]).expect(400);
    const { job_id: _drop, ...noId } = ww();
    await sync([noId]).expect(400);
  });

  it("accepts real-data quirks: full timestamps and missing names", async () => {
    await sync([ww({ updated_at: "2026-10-19T20:54:00-04:00", status: "Applied" }),
                ww({ job_id: "2", company: "", title: " ", status: "Skipped" })]).expect(200);
    const { rows } = await db.query("SELECT ww_job_id, company, title, applied_on FROM applications ORDER BY id");
    expect(rows).toEqual([
      { ww_job_id: "487008", company: "onsemi", title: "Software Developer in Test", applied_on: "2026-10-19" },
      { ww_job_id: "2", company: "(not recorded)", title: "(not recorded)", applied_on: null },
    ]);
  });

  it("never deletes rows that are missing from the file", async () => {
    await sync([ww(), ww({ job_id: "2" })]);
    await sync([ww()]);
    expect((await db.query("SELECT count(*)::int AS n FROM applications")).rows[0].n).toBe(2);
  });
});
