import { describe, expect, test } from "bun:test";
import { FACE_MATCHING_STATUS, SELFIE_MAX_AGE_MS, buildSelfiePath, checkSelfiePath, selfieGate, selfieRequiredFor, validateSelfieBytes } from "./attendance-selfie.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const at = new Date("2026-10-19T20:00:00Z"); // 20 Oct 02:00 Dhaka

describe("selfie path ownership", () => {
  test("path uses Dhaka date and owner folder", () => {
    expect(buildSelfiePath(A, at, ID)).toBe(`${A}/2026-10-20/${at.getTime()}-${ID}.jpg`);
  });
  test("own fresh path accepted", () => {
    expect(checkSelfiePath(buildSelfiePath(A, at, ID), A, at.getTime() + 60_000).ok).toBe(true);
  });
  test("another staff member's path rejected", () => {
    const r = checkSelfiePath(buildSelfiePath(B, at, ID), A, at.getTime());
    expect(r.ok).toBe(false);
  });
  test("expired after 10 minutes", () => {
    expect(checkSelfiePath(buildSelfiePath(A, at, ID), A, at.getTime() + SELFIE_MAX_AGE_MS + 1).ok).toBe(false);
  });
  test("missing, traversal and tampered date rejected", () => {
    expect(checkSelfiePath(undefined, A, at.getTime()).ok).toBe(false);
    expect(checkSelfiePath(`${A}/../${B}/x.jpg`, A, at.getTime()).ok).toBe(false);
    expect(checkSelfiePath(`${A}/2026-10-19/${at.getTime()}-${ID}.jpg`, A, at.getTime()).ok).toBe(false);
  });
});

describe("selfie bytes", () => {
  const jpeg = (n) => { const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
  test("valid jpeg accepted", () => expect(validateSelfieBytes(jpeg(5000)).ok).toBe(true));
  test("png / empty / oversized rejected", () => {
    const png = new Uint8Array(5000); png[0] = 0x89;
    expect(validateSelfieBytes(png).ok).toBe(false);
    expect(validateSelfieBytes(jpeg(100)).ok).toBe(false);
    expect(validateSelfieBytes(jpeg(1_500_001)).ok).toBe(false);
  });
});

describe("toggle and safe clock-out", () => {
  test("disabled toggle requires nothing", () => expect(selfieGate({ selfieEnabled: false, columnsPresent: false }).required).toBe(false));
  test("enabled without storage fails closed", () => expect(selfieGate({ selfieEnabled: true, columnsPresent: false })).toMatchObject({ required: true, available: false }));
  test("enabled with storage is available", () => expect(selfieGate({ selfieEnabled: true, columnsPresent: true })).toMatchObject({ required: true, available: true }));
  test("only clock-in needs a selfie", () => {
    expect(selfieRequiredFor("clock_in", true)).toBe(true);
    expect(selfieRequiredFor("clock_out", true)).toBe(false);
    expect(selfieRequiredFor("break_end", true)).toBe(false);
  });
  test("face matching is labelled not implemented", () => expect(FACE_MATCHING_STATUS).toBe("NOT_IMPLEMENTED"));
});
