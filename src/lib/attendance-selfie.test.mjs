import { describe, expect, test } from "bun:test";
import { SELFIE_MAX_AGE_MS, buildSelfiePath, checkSelfiePath, selfieGate, selfieRequiredFor, validateSelfieBytes, validateSelfieCaptureTime } from "./attendance-selfie.ts";

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

describe("camera capture timestamp", () => {
  test("recent capture time accepted", () => expect(validateSelfieCaptureTime(at.getTime(), at.getTime() + 60_000).ok).toBe(true));
  test("expired capture time rejected", () => expect(validateSelfieCaptureTime(at.getTime(), at.getTime() + SELFIE_MAX_AGE_MS + 1).ok).toBe(false));
  test("invalid and future capture times rejected", () => {
    expect(validateSelfieCaptureTime(Number.NaN, at.getTime()).ok).toBe(false);
    expect(validateSelfieCaptureTime(at.getTime() + 60_001, at.getTime()).ok).toBe(false);
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

describe("mandatory check-in photo and safe clock-out", () => {
  test("missing photo storage fails closed", () => expect(selfieGate({ columnsPresent: false })).toMatchObject({ required: true, available: false }));
  test("configured photo storage is available", () => expect(selfieGate({ columnsPresent: true })).toMatchObject({ required: true, available: true }));
  test("only clock-in needs a photo", () => {
    expect(selfieRequiredFor("clock_in")).toBe(true);
    expect(selfieRequiredFor("clock_out")).toBe(false);
    expect(selfieRequiredFor("break_start")).toBe(false);
    expect(selfieRequiredFor("break_end")).toBe(false);
  });
});
