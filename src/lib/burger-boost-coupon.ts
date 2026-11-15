/**
 * FLAMIO Burger Boost — Step 66 customer coupon rules (PURE, no I/O).
 *
 * Reference checks for issuing and redeeming a Burger Boost coupon. The stored
 * coupon row is the only source of the discount: callers never pass a percent.
 * While RELEASE_LOCKS are off, issuance and redemption always refuse, matching
 * the database lock bb_coupons_phase1_locked CHECK(false).
 */
import { RELEASE_LOCKS } from "./burger-boost-reward-flow";
import { COUPON_VALIDITY_MS } from "./burger-boost-reward";

export type StoredCoupon = {
  id: string; userId: string; sessionId: string | null; discountPercent: number;
  status: "active" | "redeemed" | "expired" | "void"; issuedAt: number; expiresAt: number; redeemedAt: number | null;
};

export type IssueCheck = { ok: true; discountPercent: number; expiresAt: number } | { ok: false; reason: "release_locked" | "over_owner_max" | "duplicate" | "invalid" };

export function checkIssue(input: {
  verifiedDiscount: number; ownerMax: number; issuedAt: number; existingForSession: boolean;
  locks?: { couponIssuance: boolean };
}): IssueCheck {
  const locks = input.locks ?? RELEASE_LOCKS;
  if (!locks.couponIssuance) return { ok: false, reason: "release_locked" };
  if (input.existingForSession) return { ok: false, reason: "duplicate" };
  const d = input.verifiedDiscount;
  if (!Number.isInteger(d) || d <= 0 || !Number.isInteger(input.ownerMax) || !Number.isFinite(input.issuedAt)) return { ok: false, reason: "invalid" };
  if (d > input.ownerMax) return { ok: false, reason: "over_owner_max" };
  return { ok: true, discountPercent: d, expiresAt: input.issuedAt + COUPON_VALIDITY_MS };
}

export type RedeemCheck =
  | { ok: true; discountPercent: number }
  | { ok: false; reason: "release_locked" | "not_found" | "wrong_customer" | "expired" | "already_used" | "inactive" | "stacking" | "invalid" };

/** `request` deliberately has no discount field; any extra key is rejected as tampering. */
export function checkRedeem(coupon: StoredCoupon | null, request: { userId: string; otherCouponApplied: boolean; [k: string]: unknown }, now: number,
  opts?: { locks?: { checkout: boolean }; ownerMax?: number }): RedeemCheck {
  const locks = opts?.locks ?? RELEASE_LOCKS;
  if (!locks.checkout) return { ok: false, reason: "release_locked" };
  const keys = Object.keys(request);
  if (keys.some((k) => k !== "userId" && k !== "otherCouponApplied")) return { ok: false, reason: "invalid" };
  if (!coupon) return { ok: false, reason: "not_found" };
  if (coupon.userId !== request.userId) return { ok: false, reason: "wrong_customer" };
  if (coupon.status === "redeemed" || coupon.redeemedAt !== null) return { ok: false, reason: "already_used" };
  if (coupon.status !== "active") return { ok: false, reason: "inactive" };
  if (!Number.isFinite(now) || now > coupon.expiresAt) return { ok: false, reason: "expired" };
  if (coupon.expiresAt - coupon.issuedAt > COUPON_VALIDITY_MS) return { ok: false, reason: "invalid" };
  if (request.otherCouponApplied) return { ok: false, reason: "stacking" };
  if (!Number.isInteger(coupon.discountPercent) || coupon.discountPercent <= 0) return { ok: false, reason: "invalid" };
  if (opts?.ownerMax !== undefined && coupon.discountPercent > opts.ownerMax) return { ok: false, reason: "invalid" };
  return { ok: true, discountPercent: coupon.discountPercent };
}
