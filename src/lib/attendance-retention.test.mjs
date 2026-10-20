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
