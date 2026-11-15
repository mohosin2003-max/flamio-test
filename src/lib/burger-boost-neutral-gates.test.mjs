import { describe, it, expect } from "bun:test";
import { lanePortalStyle, NEUTRAL_PORTAL } from "../components/burger-boost/renderers/gates.ts";
describe("neutral gate presentation", () => {
  for (const k of ["op", "math", "ingredient", "negative"]) it(`${k}: both lanes identical`, () => {
    expect(lanePortalStyle(k, 0)).toEqual(lanePortalStyle(k, 1));
    expect(lanePortalStyle(k, 0)).toEqual(NEUTRAL_PORTAL);
  });
});
