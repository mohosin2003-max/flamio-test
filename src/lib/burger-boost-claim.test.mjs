import { describe, expect, test } from "bun:test";
import { parseClaimResult } from "./burger-boost-claim.ts";
import { gameplayDiscountDisplay } from "./burger-boost-pause.ts";

const ID = "11111111-2222-4333-8444-555555555555";
const future = new Date(Date.now() + 600_000).toISOString();

describe("gameplay store discount display", () => {
  test("accumulates +2, +4, +3 to 9", () => {
    let m = 0;
    const seen = [];
    for (const d of [2, 4, 3]) {
      m += d;
      seen.push(gameplayDiscountDisplay(m));
    }
    expect(seen).toEqual([2, 6, 9]);
  });
  test("negative gates subtract and never show below 0", () => {
    expect(gameplayDiscountDisplay(6 - 3)).toBe(3);
    expect(gameplayDiscountDisplay(3 - 10)).toBe(0);
  });
});

describe("reward claim parsing", () => {
  test("reserved result yields server reservation id", () => {
    expect(
      parseClaimResult({
        result: "reserved",
        id: ID,
        discount_percent: 5,
        status: "reserved",
        expires_at: future,
      }),
    ).toEqual({ ok: true, reservationId: ID, discountPercent: 5, expiresAt: future });
  });
  test("redeemed/expired/invalid fail safely", () => {
    expect(
      parseClaimResult({
        result: "existing",
        id: ID,
        discount_percent: 5,
        status: "redeemed",
        expires_at: future,
      }).ok,
    ).toBe(false);
    expect(
      parseClaimResult({
        result: "reserved",
        id: ID,
        discount_percent: 5,
        status: "reserved",
        expires_at: "2000-01-01T00:00:00Z",
      }).ok,
    ).toBe(false);
    expect(
      parseClaimResult({
        result: "reserved",
        id: "x",
        discount_percent: 5,
        status: "reserved",
        expires_at: future,
      }).ok,
    ).toBe(false);
    expect(parseClaimResult({ result: "game_disabled" }).ok).toBe(false);
    expect(parseClaimResult(null).ok).toBe(false);
  });
});
