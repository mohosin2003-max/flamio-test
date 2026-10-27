import { describe, expect, test } from "bun:test";
import { stationDeletionDecision } from "./attendance-rules.ts";

const none = { shifts: 0, tasks: 0, usedQrChallenges: 0, activeQrChallenges: 0 };
describe("station deletion", () => {
  test("unreferenced station may be deleted", () => expect(stationDeletionDecision(none).allowed).toBe(true));
  test("historical shifts block deletion", () => expect(stationDeletionDecision({ ...none, shifts: 1 }).allowed).toBe(false));
  test("tasks block deletion", () => expect(stationDeletionDecision({ ...none, tasks: 2 }).allowed).toBe(false));
  test("used QR (clock-in evidence) blocks deletion", () => expect(stationDeletionDecision({ ...none, usedQrChallenges: 1 }).allowed).toBe(false));
  test("still-valid QR blocks deletion", () => expect(stationDeletionDecision({ ...none, activeQrChallenges: 1 }).allowed).toBe(false));
  test("blocked message advises disabling instead", () => {
    const d = stationDeletionDecision({ ...none, shifts: 3 });
    expect(d.allowed === false && /Disable it instead/.test(d.reason)).toBe(true);
  });
  test("unknown counts fail closed", () => {
    expect(stationDeletionDecision(null).allowed).toBe(false);
    expect(stationDeletionDecision({ shifts: 0, tasks: 0 }).allowed).toBe(false);
  });
});
