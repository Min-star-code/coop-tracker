import { describe, it, expect } from "vitest";
import { mergeWebEdits } from "../merge.js";

const file = () => ({
  applications: [
    { job_id: "1", company: "A", title: "QA", status: "Saved", updated_at: "2026-11-13", note: "sorted" },
    { job_id: "2", company: "B", title: "Dev", status: "Saved", updated_at: "2026-11-15T09:00:00-05:00" },
  ] as Record<string, any>[],
});

describe("mergeWebEdits", () => {
  it("writes a newer website edit into the record", () => {
    const f = file();
    const r = mergeWebEdits(f as any, [{ job_id: "1", status: "Applied", note: "applied via site", edited_at: "2026-11-14T10:00:00-05:00" }]);
    expect(r).toEqual({ written: 1, fileNewer: 0 });
    expect(f.applications[0]).toMatchObject({ status: "Applied", note: "applied via site", updated_at: "2026-11-14T10:00:00-05:00" });
  });

  it("ignores a website edit that is older than the file record", () => {
    const f = file();
    const r = mergeWebEdits(f as any, [{ job_id: "2", status: "Skipped", note: null, edited_at: "2026-11-14T10:00:00-05:00" }]);
    expect(r).toEqual({ written: 0, fileNewer: 1 });
    expect(f.applications[1].status).toBe("Saved");
  });

  it("an edit later on the same day as a date-only record wins", () => {
    const f = file();
    mergeWebEdits(f as any, [{ job_id: "1", status: "Skipped", note: null, edited_at: "2026-11-13T21:00:00-05:00" }]);
    expect(f.applications[0].status).toBe("Skipped");
    expect(f.applications[0]).not.toHaveProperty("note"); // cleared on the website -> removed
  });

  it("leaves every other record untouched", () => {
    const f = file();
    const before = JSON.stringify(f.applications[1]);
    mergeWebEdits(f as any, [{ job_id: "1", status: "Applied", note: null, edited_at: "2026-11-14T10:00:00-05:00" }]);
    expect(JSON.stringify(f.applications[1])).toBe(before);
  });
});
