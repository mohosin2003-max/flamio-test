/**
 * Burger Boost reward claim result parsing (PURE). The server RPC
 * claim_reward_reservation is the only source of the reservation id and
 * discount; the browser never computes or invents either.
 */
export type ClaimResult =
  | { ok: true; reservationId: string; discountPercent: number; expiresAt: string }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REASONS: Record<string, string> = {
  game_disabled: "Rewards aren't switched on yet.",
  not_eligible: "This game can't be claimed.",
  loss: "This game didn't earn a reward.",
  quota_exhausted: "Today's rewards are all taken. Try again tomorrow.",
};

export function parseClaimResult(data: unknown): ClaimResult {
  const r = (data ?? {}) as Record<string, unknown>;
  const result = typeof r.result === "string" ? r.result : "";
  if (result === "reserved" || result === "existing") {
    const id = r.id,
      pct = Number(r.discount_percent),
      exp = r.expires_at;
    if (r.status !== "reserved")
      return { ok: false, error: "This reward was already used or has expired." };
    if (
      typeof id !== "string" ||
      !UUID.test(id) ||
      !Number.isInteger(pct) ||
      pct <= 0 ||
      typeof exp !== "string"
    )
      return { ok: false, error: "This reward couldn't be confirmed." };
    if (!(Date.parse(exp) > Date.now())) return { ok: false, error: "This reward has expired." };
    return { ok: true, reservationId: id, discountPercent: pct, expiresAt: exp };
  }
  return { ok: false, error: REASONS[result] ?? "This reward couldn't be confirmed." };
}
