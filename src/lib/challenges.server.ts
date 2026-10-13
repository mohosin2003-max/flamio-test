/**
 * Server-only challenge engine.
 *
 * Everything that decides "may this customer play?" and "did they win?" lives
 * here and runs with the service role. The browser is never trusted for play
 * counts, win outcomes or reward issuance.
 */

import { DETECTORS } from "@/lib/challenges";
import type { ChallengePlayAccess, ChallengeUnlockMethod, DetectorType } from "@/lib/challenges";

export type ChallengeRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  instructions: string | null;
  game_type: string;
  detector_type: string;
  icon_emoji: string;
  difficulty: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  attempts_per_session: number;
  required_score: number;
  required_accuracy: number | null;
  time_limit_seconds: number | null;
  winning_condition: Record<string, unknown>;
  difficulty_config: Record<string, unknown>;
  rules_config: Record<string, unknown>;
  reward_type: string;
  reward_name: string;
  reward_quantity: number;
  reward_coupon_id: string | null;
  reward_points: number;
  base_plays: number;
  max_stored_plays: number;
  max_plays_per_customer: number;
  cooldown_minutes: number;
  refill_enabled: boolean;
  refill_interval_minutes: number;
  refill_amount: number;
  order_unlock_enabled: boolean;
  order_min_amount: number;
  order_unlock_plays: number;
  order_unlock_max: number;
  order_unlock_stack: boolean;
  order_required_status: string;
  referral_unlock_enabled: boolean;
  referral_required_count: number;
  referral_unlock_plays: number;
  referral_unlock_max: number;
  referral_cooldown_hours: number;
  referral_verification: string;
  daily_winner_limit: number;
  total_winner_limit: number;
  max_wins_per_customer: number;
  sort_order: number;
};

export const CHALLENGE_COLUMNS = "*";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getChallengeSettings() {
  const db = await admin();
  const { data } = await db
    .from("challenge_settings")
    .select("*")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (
    data ?? {
      id: "",
      is_enabled: false,
      ticker_enabled: false,
      ticker_max_winners: 10,
      ticker_duration_seconds: 4,
      winner_retention_days: 30,
      auto_cleanup_enabled: false,
    }
  );
}

/** Is the challenge inside its date window and daily time window right now? */
export function isWindowOpen(challenge: ChallengeRow, now = new Date()): boolean {
  const today = now.toISOString().slice(0, 10);
  if (challenge.starts_on && today < challenge.starts_on) return false;
  if (challenge.ends_on && today > challenge.ends_on) return false;
  const start = challenge.daily_start_time;
  const end = challenge.daily_end_time;
  if (start && end) {
    const clock = now.toTimeString().slice(0, 5);
    if (start <= end) return clock >= start && clock <= end;
    return clock >= start || clock <= end;
  }
  return true;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Insert any play grants the customer has legitimately earned. Every grant row
 * carries a unique (source, reference) so a refresh, a double click or a retry
 * can never award the same play twice.
 */
async function syncGrants(userId: string, challenge: ChallengeRow) {
  const db = await admin();
  const now = Date.now();

  const { data: existing } = await db
    .from("challenge_play_grants")
    .select("source, plays, reference, created_at")
    .eq("challenge_id", challenge.id)
    .eq("user_id", userId);
  const grants = existing ?? [];

  const rows: {
    challenge_id: string;
    user_id: string;
    source: string;
    plays: number;
    reference: string;
  }[] = [];

  // Base allowance, once per customer.
  const base = grants.find((g) => g.source === "base");
  if (!base && challenge.base_plays > 0) {
    rows.push({
      challenge_id: challenge.id,
      user_id: userId,
      source: "base",
      plays: challenge.base_plays,
      reference: "base",
    });
  }

  const anchor = base ? new Date(base.created_at).getTime() : now;
  const used = grants.reduce((sum, g) => sum + g.plays, 0);

  // Time-based refill: only the current interval bucket can be granted, and
  // only while the customer is below their maximum stored plays.
  let nextRefillAt: string | null = null;
  if (challenge.refill_enabled && challenge.refill_interval_minutes > 0) {
    const interval = challenge.refill_interval_minutes * 60_000;
    const bucket = Math.floor((now - anchor) / interval);
    nextRefillAt = new Date(anchor + (bucket + 1) * interval).toISOString();
    if (bucket >= 1 && !grants.some((g) => g.source === "refill" && g.reference === String(bucket))) {
      rows.push({
        challenge_id: challenge.id,
        user_id: userId,
        source: "refill",
        plays: Math.max(1, challenge.refill_amount),
        reference: String(bucket),
      });
    }
  }

  // Order-based unlock: only qualifying orders in the configured status count.
  if (challenge.order_unlock_enabled) {
    const already = grants.filter((g) => g.source === "order");
    const awarded = already.reduce((sum, g) => sum + g.plays, 0);
    const capReached =
      challenge.order_unlock_max > 0 && awarded >= challenge.order_unlock_max;
    if (!capReached) {
      const query = db
        .from("orders")
        .select("id, total, status")
        .eq("user_id", userId)
        .eq("status", challenge.order_required_status)
        .gte("total", challenge.order_min_amount)
        .order("created_at", { ascending: false })
        .limit(challenge.order_unlock_stack ? 50 : 1);
      const { data: orders } = await query;
      for (const order of orders ?? []) {
        if (already.some((g) => g.reference === order.id)) continue;
        if (!challenge.order_unlock_stack && already.length > 0) break;
        rows.push({
          challenge_id: challenge.id,
          user_id: userId,
          source: "order",
          plays: Math.max(1, challenge.order_unlock_plays),
          reference: order.id,
        });
        if (!challenge.order_unlock_stack) break;
      }
    }
  }

  // Referral / social unlock: counted from owner-approved reward claims only.
  let verifiedReferrals = 0;
  if (challenge.referral_unlock_enabled) {
    const { data: claims } = await db
      .from("reward_claims")
      .select("id, status, reward_rules(slug)")
      .eq("user_id", userId)
      .eq("status", "approved");
    verifiedReferrals = (claims ?? []).filter((claim) => {
      const rule = Array.isArray(claim.reward_rules) ? claim.reward_rules[0] : claim.reward_rules;
      const slug = rule?.slug ?? "";
      return slug.includes("referral") || slug.includes("social") || slug.includes("share");
    }).length;

    const required = Math.max(1, challenge.referral_required_count);
    let unlocks = Math.floor(verifiedReferrals / required);
    if (challenge.referral_unlock_max > 0) unlocks = Math.min(unlocks, challenge.referral_unlock_max);
    for (let index = 1; index <= unlocks; index += 1) {
      if (grants.some((g) => g.source === "referral" && g.reference === String(index))) continue;
      rows.push({
        challenge_id: challenge.id,
        user_id: userId,
        source: "referral",
        plays: Math.max(1, challenge.referral_unlock_plays),
        reference: String(index),
      });
    }
  }

  if (rows.length > 0) {
    await db.from("challenge_play_grants").upsert(rows, {
      onConflict: "challenge_id,user_id,source,reference",
      ignoreDuplicates: true,
    });
  }

  return {
    earned: used + rows.reduce((sum, r) => sum + r.plays, 0),
    nextRefillAt,
    verifiedReferrals,
  };
}

export async function computePlayAccess(
  userId: string,
  challenge: ChallengeRow,
): Promise<ChallengePlayAccess> {
  const db = await admin();
  const { earned, nextRefillAt, verifiedReferrals } = await syncGrants(userId, challenge);

  const { data: state } = await db
    .from("challenge_play_state")
    .select("plays_used, last_play_at")
    .eq("challenge_id", challenge.id)
    .eq("user_id", userId)
    .maybeSingle();

  const playsUsed = state?.plays_used ?? 0;
  const maxStored = Math.max(1, challenge.max_stored_plays);
  let available = Math.max(0, Math.min(earned - playsUsed, maxStored));

  let lockedReason: string | null = null;
  let cooldownUntil: string | null = null;

  if (challenge.max_plays_per_customer > 0 && playsUsed >= challenge.max_plays_per_customer) {
    available = 0;
    lockedReason = "You have used all your plays for this challenge.";
  }

  if (available > 0 && challenge.cooldown_minutes > 0 && state?.last_play_at) {
    const until = new Date(state.last_play_at).getTime() + challenge.cooldown_minutes * 60_000;
    if (until > Date.now()) {
      available = 0;
      cooldownUntil = new Date(until).toISOString();
      lockedReason = "This challenge is cooling down.";
    }
  }

  const unlockMethods: ChallengeUnlockMethod[] = [];
  if (challenge.refill_enabled) {
    unlockMethods.push({
      kind: "refill",
      plays: challenge.refill_amount,
      intervalMinutes: challenge.refill_interval_minutes,
      nextAt: nextRefillAt,
    });
  }
  if (challenge.order_unlock_enabled) {
    unlockMethods.push({
      kind: "order",
      plays: challenge.order_unlock_plays,
      minAmount: Number(challenge.order_min_amount),
      requiredStatus: challenge.order_required_status,
    });
  }
  if (challenge.referral_unlock_enabled) {
    unlockMethods.push({
      kind: "referral",
      plays: challenge.referral_unlock_plays,
      required: challenge.referral_required_count,
      verified: verifiedReferrals,
      verification: challenge.referral_verification,
    });
  }

  return {
    available,
    playsUsed,
    maxStored,
    lockedReason,
    cooldownUntil,
    nextRefillAt,
    unlockMethods,
  };
}

export async function countDailyWinners(challengeId: string): Promise<number> {
  const db = await admin();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("challenge_winners")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", challengeId)
    .gte("won_at", since.toISOString());
  return count ?? 0;
}

/** Scale a detector config by the selected difficulty. */
export function effectiveConfig(challenge: ChallengeRow): Record<string, number> {
  const raw = { ...(challenge.difficulty_config as Record<string, unknown>) };
  const config: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") config[key] = value;
  }
  const factor =
    challenge.difficulty === "easy"
      ? 1.35
      : challenge.difficulty === "hard"
        ? 0.85
        : challenge.difficulty === "expert"
          ? 0.65
          : 1;
  if (factor !== 1) {
    for (const key of ["max_reaction_ms", "zone_width", "tolerance", "spawn_ms"]) {
      if (config[key] !== undefined) config[key] = Math.max(1, Math.round(config[key] * factor));
    }
  }
  return config;
}

/** Consume one play and open a session. Returns the session plus any server-decided outcome. */
export async function openSession(userId: string, challenge: ChallengeRow) {
  const db = await admin();
  const detector = DETECTORS[challenge.detector_type as DetectorType];
  if (!detector?.implemented) {
    throw new Error("This challenge isn't playable yet.");
  }
  if (challenge.status !== "active" || !isWindowOpen(challenge)) {
    throw new Error("This challenge isn't running right now.");
  }

  // Expire abandoned sessions so a crash cannot block or duplicate play.
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  await db
    .from("challenge_sessions")
    .update({ status: "expired", completed_at: new Date().toISOString() })
    .eq("challenge_id", challenge.id)
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .lt("started_at", staleCutoff);

  const { data: live } = await db
    .from("challenge_sessions")
    .select("id, seed, started_at")
    .eq("challenge_id", challenge.id)
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (live) {
    return { sessionId: live.id, outcome: parseSeed(live.seed), resumed: true };
  }

  const access = await computePlayAccess(userId, challenge);
  if (access.available <= 0) {
    throw new Error(access.lockedReason ?? "You have no plays available right now.");
  }

  // Consume the play with a conditional update so parallel clicks cannot
  // both succeed on the same play.
  const { data: current } = await db
    .from("challenge_play_state")
    .select("id, plays_used")
    .eq("challenge_id", challenge.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (current) {
    const { data: updated } = await db
      .from("challenge_play_state")
      .update({ plays_used: current.plays_used + 1, last_play_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("plays_used", current.plays_used)
      .select("id");
    if (!updated || updated.length === 0) throw new Error("Please try again.");
  } else {
    const { error } = await db.from("challenge_play_state").insert({
      challenge_id: challenge.id,
      user_id: userId,
      plays_used: 1,
      last_play_at: new Date().toISOString(),
    });
    if (error) throw new Error("Please try again.");
  }

  const outcome = rollOutcome(challenge);
  const { data: session, error: sessionError } = await db
    .from("challenge_sessions")
    .insert({
      challenge_id: challenge.id,
      user_id: userId,
      status: "in_progress",
      seed: outcome ? JSON.stringify(outcome) : null,
    })
    .select("id")
    .single();
  if (sessionError || !session) throw new Error("We couldn't start this challenge.");

  return { sessionId: session.id, outcome, resumed: false };
}

function parseSeed(seed: string | null): ChanceOutcome | null {
  if (!seed) return null;
  try {
    return JSON.parse(seed) as ChanceOutcome;
  } catch {
    return null;
  }
}

export type ChanceOutcome = { kind: "dice"; dice: number[]; win: boolean } | { kind: "coin"; tosses: string[]; win: boolean };

/** Chance games are decided on the server at play time — the client only animates. */
function rollOutcome(challenge: ChallengeRow): ChanceOutcome | null {
  const condition = challenge.winning_condition as Record<string, unknown>;
  if (challenge.detector_type === "dice_detector") {
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    const value = num(condition["value"], 6);
    const type = String(condition["type"] ?? "double");
    const win =
      type === "sum"
        ? dice[0]! + dice[1]! >= value
        : dice[0] === dice[1] && (value === 0 || dice[0] === value);
    return { kind: "dice", dice, win };
  }
  if (challenge.detector_type === "coin_detector") {
    const count = Math.max(1, num(condition["tosses"], 5));
    const requiredHeads = Math.max(1, num(condition["required_heads"], count));
    const tosses = Array.from({ length: count }, () => (Math.random() < 0.5 ? "heads" : "tails"));
    const heads = tosses.filter((t) => t === "heads").length;
    return { kind: "coin", tosses, win: heads >= requiredHeads };
  }
  return null;
}

/** Judge a finished session, apply reward limits and record a winner. */
export async function resolveSession(
  userId: string,
  sessionId: string,
  reportedScore: number,
): Promise<{
  result: "won" | "lost";
  message: string;
  rewardName?: string;
  couponCode?: string | null;
  winnerId?: string;
  outcome?: ChanceOutcome | null;
  resultRewards?: { ruleName: string; points: number }[];
}> {
  const db = await admin();
  const { data: session } = await db
    .from("challenge_sessions")
    .select("id, challenge_id, user_id, status, seed, started_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) throw new Error("Session not found.");
  if (session.status !== "in_progress") throw new Error("This play has already finished.");

  const { data: challengeRow } = await db
    .from("challenges")
    .select(CHALLENGE_COLUMNS)
    .eq("id", session.challenge_id)
    .single();
  const challenge = challengeRow as unknown as ChallengeRow;

  const outcome = parseSeed(session.seed);
  let won: boolean;
  if (outcome) {
    won = outcome.win;
  } else {
    const elapsed = Date.now() - new Date(session.started_at).getTime();
    const limit = challenge.time_limit_seconds;
    const withinTime = !limit || elapsed <= (limit + 5) * 1000;
    won = withinTime && reportedScore >= Number(challenge.required_score);
  }

  const nowIso = new Date().toISOString();
  await db
    .from("challenge_sessions")
    .update({ status: won ? "won" : "lost", score: reportedScore, completed_at: nowIso })
    .eq("id", session.id)
    .eq("status", "in_progress");

  if (!won) {
    // Optional owner-configured consolation rewards (lost / almost won).
    const { awardChallengeResultRewards } = await import("@/lib/challenge-rewards.server");
    const resultRewards = await awardChallengeResultRewards({
      userId,
      challengeId: challenge.id,
      sessionId: session.id,
      score: reportedScore,
      requiredScore: Number(challenge.required_score),
      scored: !outcome,
    });
    return {
      result: "lost",
      message: "Not this time — your play has been used.",
      outcome,
      resultRewards,
    };
  }

  // Reward protection: every limit is checked here, server-side.
  const [{ count: totalWinners }, { count: myWins }] = await Promise.all([
    db
      .from("challenge_winners")
      .select("id", { count: "exact", head: true })
      .eq("challenge_id", challenge.id),
    db
      .from("challenge_winners")
      .select("id", { count: "exact", head: true })
      .eq("challenge_id", challenge.id)
      .eq("user_id", userId),
  ]);
  const daily = await countDailyWinners(challenge.id);

  if (challenge.daily_winner_limit > 0 && daily >= challenge.daily_winner_limit) {
    return {
      result: "won",
      message: "Today's rewards have been claimed. Come back tomorrow! ❤️",
      outcome,
    };
  }
  if (challenge.total_winner_limit > 0 && (totalWinners ?? 0) >= challenge.total_winner_limit) {
    return { result: "won", message: "All rewards for this challenge have been claimed.", outcome };
  }
  if (challenge.max_wins_per_customer > 0 && (myWins ?? 0) >= challenge.max_wins_per_customer) {
    return {
      result: "won",
      message: "You've already claimed the maximum reward for this challenge.",
      outcome,
    };
  }

  let couponCode: string | null = null;
  if (challenge.reward_type === "coupon" && challenge.reward_coupon_id) {
    const { data: coupon } = await db
      .from("coupons")
      .select("code")
      .eq("id", challenge.reward_coupon_id)
      .maybeSingle();
    couponCode = coupon?.code ?? null;
  }

  const { data: winner, error: winnerError } = await db
    .from("challenge_winners")
    .insert({
      challenge_id: challenge.id,
      session_id: session.id,
      user_id: userId,
      reward_type: challenge.reward_type,
      reward_name: challenge.reward_name,
      reward_quantity: challenge.reward_quantity,
      coupon_code: couponCode,
      result: outcome ? { outcome } : { score: reportedScore },
      claim_status: "pending",
    })
    .select("id")
    .single();

  if (winnerError) {
    // Unique(session_id) blocks any duplicate reward for the same play.
    return { result: "won", message: "Your reward is already recorded.", outcome };
  }

  if (challenge.reward_type === "points" && challenge.reward_points > 0) {
    await db.from("reward_transactions").insert({
      user_id: userId,
      action_key: "challenge_win",
      reference_id: session.id,
      points: challenge.reward_points,
      description: `${challenge.name} win`,
    });
  }

  return {
    result: "won",
    message: "You won!",
    rewardName: challenge.reward_name,
    couponCode,
    winnerId: winner.id,
    outcome,
  };
}

/** Remove winner records older than the retention window. Only winner rows are touched. */
export async function cleanupWinners(days: number): Promise<number> {
  const db = await admin();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await db
    .from("challenge_winners")
    .delete()
    .lt("won_at", cutoff)
    .select("id");
  return data?.length ?? 0;
}
