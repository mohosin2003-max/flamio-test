import { describe, expect, test } from "bun:test";
import { purgeRetention } from "./attendance-retention.ts";
import { retentionEligibleSessions } from "./attendance-rules.ts";

function fakeStore({ storageFails = () => false, breaksFail = false, sessionDrop = new Set() } = {}) {
  const files = new Set(["u/a.jpg", "u/b.jpg"]);
  const sessions = new Set(["s1", "s2", "s3"]);
  const log = [];
  return {
    files, sessions, log,
    ports: {
      async removeFiles(paths) {
        log.push(["files", paths]);
        if (storageFails(paths)) return { error: "storage down" };
        paths.forEach((p) => files.delete(p)); // missing files are not an error
        return { error: null };
      },
      async deleteBreaks(ids) { log.push(["breaks", ids]); return { error: breaksFail ? "db down" : null }; },
      async deleteSessions(ids) {
        log.push(["sessions", ids]);
        const done = ids.filter((id) => sessions.has(id) && !sessionDrop.has(id));
        done.forEach((id) => sessions.delete(id));
        return { deletedIds: done, error: null };
      },
    },
  };
}

const C = [{ id: "s1", selfiePath: "u/a.jpg" }, { id: "s2", selfiePath: "u/b.jpg" }, { id: "s3", selfiePath: null }];

describe("selfie retention purge", () => {
  test("removes files before deleting sessions", async () => {
    const s = fakeStore();
    const r = await purgeRetention(C, s.ports);
    expect(r).toMatchObject({ deletedSessions: 3, removedSelfieFiles: 2, partial: false });
    expect(s.log.map((l) => l[0])).toEqual(["files", "breaks", "sessions"]);
    expect(s.files.size).toBe(0);
  });

  test("sessions without a selfie are deleted without a storage call", async () => {
    const s = fakeStore();
    const r = await purgeRetention([{ id: "s3", selfiePath: null }], s.ports);
    expect(r.deletedSessions).toBe(1);
    expect(s.log.some((l) => l[0] === "files")).toBe(false);
  });

  test("already-missing files still allow cleanup", async () => {
    const s = fakeStore();
    s.files.clear();
    const r = await purgeRetention(C, s.ports);
    expect(r.deletedSessions).toBe(3);
  });

  test("storage failure keeps the session references", async () => {
    const s = fakeStore({ storageFails: () => true });
    const r = await purgeRetention(C, s.ports);
    expect(r.storageFailedSessions.sort()).toEqual(["s1", "s2"]);
    expect(r.deletedSessions).toBe(1);
    expect(s.sessions.has("s1") && s.sessions.has("s2")).toBe(true);
    expect(r.partial).toBe(true);
  });

  test("storage failure in one batch does not block other batches", async () => {
    const s = fakeStore({ storageFails: (p) => p.includes("u/a.jpg") });
    const r = await purgeRetention(C, s.ports, 1);
    expect(r.storageFailedSessions).toEqual(["s1"]);
    expect(s.sessions.has("s1")).toBe(true);
    expect(s.sessions.has("s2")).toBe(false);
  });

  test("partial database deletion is reported and retry finishes", async () => {
    const drop = new Set(["s2"]);
    const s = fakeStore({ sessionDrop: drop });
    const first = await purgeRetention(C, s.ports);
    expect(first.databaseFailedSessions).toEqual(["s2"]);
    expect(first.partial).toBe(true);
    drop.clear();
    const retry = await purgeRetention([{ id: "s2", selfiePath: "u/b.jpg" }], s.ports);
    expect(retry).toMatchObject({ deletedSessions: 1, partial: false });
    expect(s.sessions.size).toBe(0);
  });

  test("breaks deletion failure leaves sessions in place", async () => {
    const s = fakeStore({ breaksFail: true });
    const r = await purgeRetention(C, s.ports);
    expect(r.deletedSessions).toBe(0);
    expect(r.databaseFailedSessions.length).toBe(3);
    expect(s.sessions.size).toBe(3);
  });

  test("open, auto-closed and disputed sessions are never candidates", () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const old = "2026-08-01T00:00:00Z";
    const rows = [
      { id: "ok", clockOutAt: old, status: "closed", verificationStatus: "verified" },
      { id: "open", clockOutAt: null, status: "open", verificationStatus: "verified" },
      { id: "auto", clockOutAt: old, status: "auto_closed", verificationStatus: "verified" },
      { id: "disp", clockOutAt: old, status: "closed", verificationStatus: "disputed" },
    ];
    expect(retentionEligibleSessions(rows, cutoff).map((r) => r.id)).toEqual(["ok"]);
  });
});

import { previousDhakaMonth, classifyMonthlyRetention } from "./attendance-retention.ts";

describe("calendar-month boundaries (Asia/Dhaka)", () => {
  test("run on 1 Nov 00:00 Dhaka selects all of October Dhaka", () => {
    const w = previousDhakaMonth(new Date("2026-10-31T18:00:00Z"));
    expect(w).toEqual({ label: "2026-10", startUtc: "2026-09-30T18:00:00.000Z", endUtc: "2026-10-31T18:00:00.000Z" });
  });
  test("31 Oct 23:59 Dhaka still targets September", () => {
    expect(previousDhakaMonth(new Date("2026-10-31T17:59:00Z")).label).toBe("2026-09");
  });
  test("January run targets December of the previous year", () => {
    expect(previousDhakaMonth(new Date("2027-01-01T00:00:00Z")).label).toBe("2026-12");
  });
  test("leap February ends on 29th", () => {
    expect(previousDhakaMonth(new Date("2028-03-05T00:00:00Z")).endUtc).toBe("2028-02-29T18:00:00.000Z");
  });
});

describe("monthly dry-run classification", () => {
  const w = previousDhakaMonth(new Date("2026-11-01T00:00:00Z"));
  const row = (id, o = {}) => ({ id, clockOutAt: "2026-10-10T08:00:00Z", status: "closed", verificationStatus: "verified", selfiePath: null, ...o });
  test("separates eligible, protected, skipped and failed", () => {
    const p = classifyMonthlyRetention([
      row("ok", { selfiePath: "u/x.jpg" }),
      row("first", { clockOutAt: "2026-09-30T18:00:00Z" }),
      row("lastMs", { clockOutAt: "2026-10-31T17:59:59.999Z" }),
      row("nextMonth", { clockOutAt: "2026-10-31T18:00:00Z" }),
      row("before", { clockOutAt: "2026-09-30T17:59:59Z" }),
      row("open", { clockOutAt: null, status: "open" }),
      row("auto", { status: "auto_closed" }),
      row("disp", { verificationStatus: "disputed" }),
      row("pend"),
      row("bad", { clockOutAt: "not-a-date" }),
    ], ["pend"], w);
    expect(p.eligible.map((e) => e.id)).toEqual(["ok", "first", "lastMs"]);
    expect(p.eligible[0].hasSelfie).toBe(true);
    expect(p.protected).toEqual([{ id: "open", reason: "open" }, { id: "auto", reason: "auto_closed" }, { id: "disp", reason: "disputed" }, { id: "pend", reason: "pending_request" }]);
    expect(p.skipped.map((s) => s.id)).toEqual(["nextMonth", "before"]);
    expect(p.failed).toEqual([{ id: "bad", reason: "invalid_clock_out" }]);
  });
  test("protection beats an in-window date", () => {
    const p = classifyMonthlyRetention([row("d", { verificationStatus: "disputed" })], ["d"], w);
    expect(p.eligible.length).toBe(0);
  });
});

describe("failure recovery: file removed but database delete failed", () => {
  test("retry re-removes the already-missing file without error and finishes DB cleanup", async () => {
    const files = new Set(["u/a.jpg"]);
    const sessions = new Set(["s1"]);
    let dbDown = true;
    const ports = {
      async removeFiles(paths) { paths.forEach((p) => files.delete(p)); return { error: null }; },
      async deleteBreaks() { return { error: null }; },
      async deleteSessions(ids) {
        if (dbDown) return { deletedIds: [], error: "db down" };
        ids.forEach((id) => sessions.delete(id)); return { deletedIds: ids, error: null };
      },
    };
    const first = await purgeRetention([{ id: "s1", selfiePath: "u/a.jpg" }], ports);
    expect(first).toMatchObject({ deletedSessions: 0, removedSelfieFiles: 1, databaseFailedSessions: ["s1"], partial: true });
    expect(files.has("u/a.jpg")).toBe(false);
    expect(sessions.has("s1")).toBe(true); // reference kept, so the retry can find it
    dbDown = false;
    const retry = await purgeRetention([{ id: "s1", selfiePath: "u/a.jpg" }], ports);
    expect(retry).toMatchObject({ deletedSessions: 1, partial: false });
    expect(sessions.size).toBe(0);
  });
});
