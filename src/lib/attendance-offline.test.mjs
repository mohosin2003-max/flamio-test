import { describe, expect, test } from "bun:test";
import { enqueue, flush, isAuthError, isPermanentError, isTransientNetworkError, memoryStorage, retryFailed, clearConfirmed, reconcileConflict } from "./attendance-offline.ts";

const at = (s) => new Date(`2026-10-18T06:00:${s}Z`);

describe("queue ordering and idempotency", () => {
  test("flush sends in tap order and confirms only after ack", async () => {
    const st = memoryStorage();
    await enqueue(st, "clock_out", "b", at("10"));
    await enqueue(st, "clock_in", "a", at("05"));
    const sent = [];
    await flush(st, async (i) => { expect((await st.all()).find((x) => x.id === i.id).state).toBe("syncing"); sent.push(i.id); });
    expect(sent).toEqual(["a", "b"]);
    expect((await st.all()).every((i) => i.state === "confirmed")).toBe(true);
  });
  test("same action cannot be queued twice while unresolved", async () => {
    const st = memoryStorage();
    await enqueue(st, "break_start", "x", at("01"));
    await expect(enqueue(st, "break_start", "y", at("02"))).rejects.toThrow();
  });
  test("each idempotency key is sent once", async () => {
    const st = memoryStorage();
    await enqueue(st, "clock_in", "k", at("01"));
    let n = 0;
    await flush(st, async () => { n++; });
    await flush(st, async () => { n++; });
    expect(n).toBe(1);
  });
  test("transient failure stops later actions overtaking earlier ones", async () => {
    const st = memoryStorage();
    await enqueue(st, "clock_in", "a", at("01"));
    await enqueue(st, "clock_out", "b", at("02"));
    const sent = [];
    await flush(st, async (i) => { sent.push(i.id); throw new TypeError("Failed to fetch"); });
    expect(sent).toEqual(["a"]);
    expect((await st.all()).map((i) => i.state)).toEqual(["pending", "pending"]);
  });
});

describe("error classification", () => {
  test("network errors are transient", () => {
    expect(isTransientNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientNetworkError(new Error("anything"), false)).toBe(true);
  });
  test("auth and validation errors are not transient", () => {
    expect(isTransientNetworkError(new Error("Unauthorized"))).toBe(false);
    expect(isTransientNetworkError(new Error("You are outside the station geofence"))).toBe(false);
    expect(isTransientNetworkError(new Error("Something odd"))).toBe(false);
    expect(isAuthError("Forbidden")).toBe(true);
    expect(isPermanentError("Already clocked in")).toBe(true);
  });
  test("permanent and auth errors mark failed without retry; retryFailed resets", async () => {
    const st = memoryStorage();
    await enqueue(st, "clock_in", "a", at("01"));
    await flush(st, async () => { throw new Error("Unauthorized"); });
    expect((await st.all())[0]).toMatchObject({ state: "failed", attempts: 1 });
    await retryFailed(st, "a");
    expect((await st.all())[0]).toMatchObject({ state: "pending", attempts: 0 });
    await flush(st, async () => {});
    await clearConfirmed(st);
    expect(await st.all()).toEqual([]);
  });
});

describe("QR exclusion", () => {
  test("QR clock-in cannot be queued", async () => {
    await expect(enqueue(memoryStorage(), "clock_in", "q", at("01"), { qrToken: "t" })).rejects.toThrow(/QR/);
  });
});

describe("lost-response reconciliation", () => {
  const tap = "2026-10-18T06:00:00.000Z";
  const none = { activeSession: null, activeBreak: null, lastClosedSession: null };
  test("clock-in confirmed only when the open session began after the tap", () => {
    expect(reconcileConflict({ kind: "clock_in", requestedAt: tap }, { ...none, activeSession: { clockInAt: "2026-10-18T06:00:20.000Z" } }).confirmed).toBe(true);
    expect(reconcileConflict({ kind: "clock_in", requestedAt: tap }, { ...none, activeSession: { clockInAt: "2026-10-18T02:00:00.000Z" } }).confirmed).toBe(false);
  });
  test("break start from an earlier unrelated break is not claimed", () => {
    expect(reconcileConflict({ kind: "break_start", requestedAt: tap }, { ...none, activeBreak: { startedAt: "2026-10-18T05:00:00.000Z" } }).confirmed).toBe(false);
    expect(reconcileConflict({ kind: "break_start", requestedAt: tap }, { ...none, activeBreak: { startedAt: "2026-10-18T06:01:00.000Z" } }).confirmed).toBe(true);
  });
  test("clock-out confirmed only with no open session and a later clock-out", () => {
    expect(reconcileConflict({ kind: "clock_out", requestedAt: tap }, { ...none, lastClosedSession: { clockOutAt: "2026-10-18T06:00:30.000Z" } }).confirmed).toBe(true);
    expect(reconcileConflict({ kind: "clock_out", requestedAt: tap }, { ...none, lastClosedSession: { clockOutAt: "2026-10-17T20:00:00.000Z" } }).confirmed).toBe(false);
  });
  test("break end is never auto-confirmed", () => {
    expect(reconcileConflict({ kind: "break_end", requestedAt: tap }, none).confirmed).toBe(false);
  });
});
