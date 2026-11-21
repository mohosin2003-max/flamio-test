import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { nextFacingMode } from "./attendance-selfie.ts";

describe("check-in photo evidence camera", () => {
  test("front switches to rear", () => { expect(nextFacingMode("user")).toBe("environment"); });
  test("rear switches to front", () => { expect(nextFacingMode("environment")).toBe("user"); });
  test("capture dialog has no gallery file input", () => {
    const src = readFileSync(new URL("../components/attendance/SelfieCaptureDialog.tsx", import.meta.url), "utf8");
    expect(src.includes('type="file"')).toBe(false);
  });
});
