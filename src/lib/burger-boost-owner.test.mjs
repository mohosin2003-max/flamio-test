import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateTrack, sanitizeGates } from "./burger-boost-rules.ts";

describe("burger boost public gates + owner overview", () => {
  test("sanitized gates carry no answers and keep layout", () => {
    const track = generateTrack(123456789n, 1, 30);
    const pub = sanitizeGates(track);
    expect(pub.length).toBe(30);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("correctLane");
    // Gap 2 (owner-approved): spoiledLane is visible obstacle info.
    pub.forEach((g, i) => {
      expect(g.kind).toBe(track[i].kind);
      if (g.kind === "math") expect(g.lanes).toEqual(track[i].lanes);
    });
  });
  test("owner overview is server-checked and locked", () => {
    const src = readFileSync(new URL("./burger-boost-owner.functions.ts", import.meta.url), "utf8");
    expect(src).toContain("requireSupabaseAuth");
    expect(src).toMatch(/assertPermission\(context\.userId, "challenges"/);
    expect(src).not.toMatch(/^import .*client\.server/m);
    expect(src).toContain("gameEnabled: false");
    expect(src).toContain("discountPercent: 0");
    expect(src).toContain("persisted: false");
  });
});
