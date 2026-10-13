/**
 * Server-only Challenge Result Reward engine.
 *
 * Optional, additive layer on top of the existing rewards system: when a
 * customer loses (or almost wins) a challenge, owner-configured rules can add
 * points to the EXISTING reward balance (reward_transactions).
 *
 * Anti-duplicate guarantee: every qualifying result writes exactly one
 * challenge_result_reward_events row, protected by unique(rule_id, session_id).
 * The reward transaction is keyed to that event id through the existing
 * unique(user_id, action_key, reference_id) constraint, so a refresh, retry or
 * duplicate submission can never award twice.
 */

import { dhakaDateKey, dhakaDayBounds } from "@/lib/dates";

export const CHALLENGE_RESULT_ACTION_KEY = "challenge_result";

export type ChallengeResultRewardRule = {
  id: string;
  name: string;
  challenge_id: string | null;
  result_condition: "lost" | "close";
  close_threshold_percent: number;
  points: number;
  is_enabled: boolean;
  first_time_only: boolean;
  max_per_customer: number;
  max_per_day: number;
  max_per_challenge: number;
  allow_repeat_after_limit: boolean;
  starts_on: string | null;
  ends_on: string | null;
};

export type AwardedChallengeReward = { ruleName: string; points: number };

async function admin() {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return untypedAdmin();
}

/** True when the rules feature has not been installed in this database yet. */
function isMissingTable(error: { code?: string | null } | null): boolean {
  return error?.code === "42P01";
}

/**
 * Award any qualifying result rewards for one finished, non-winning session.
 * Never throws — reward rules must not break a challenge play.
 */
export async function awardChallengeResultRewards(input: {
  userId: string;
  challengeId: string;
  sessionId: string;
  score: number;
  requiredScore: number;
  scored: boolean;
}): Promise<AwardedChallengeReward[]> {
  try {
    const db = await admin();
    const today = dhakaDateKey();

    const { data: ruleRows, error: ruleError } = await db
      .from("challenge_result_reward_rules")
      .select("*")
      .eq("is_enabled", true);
    if (ruleError) {
      if (!isMissingTable(ruleError)) console.error("challenge result rules", ruleError);
      return [];
    }

    const rules = ((ruleRows ?? []) as unknown as ChallengeResultRewardRule[]).filter((rule) => {
      if (rule.challenge_id && rule.challenge_id !== input.challengeId) return false;
      if (rule.starts_on && today < rule.starts_on) return false;
      if (rule.ends_on && today > rule.ends_on) return false;
      if (rule.points <= 0) return false;
      if (rule.result_condition === "close") {
        if (!input.scored || input.requiredScore <= 0) return false;
        const ratio = (input.score / input.requiredScore) * 100;
        return ratio >= rule.close_threshold_percent && input.score < input.requiredScore;
      }
      return true;
    });

    if (rules.length === 0) return [];

    const awarded: AwardedChallengeReward[] = [];
    for (const rule of rules) {
      const blockedReason = rule.allow_repeat_after_limit && !rule.first_time_only
        ? null
        : await findLimitBlock(rule, input.userId, input.challengeId, today);

      const { data: event, error: eventError } = await db
        .from("challenge_result_reward_events")
        .insert({
          rule_id: rule.id,
          challenge_id: input.challengeId,
          session_id: input.sessionId,
          user_id: input.userId,
          result_condition: rule.result_condition,
          points: blockedReason ? 0 : rule.points,
          status: blockedReason ? "blocked" : "awarded",
          blocked_reason: blockedReason,
        })
        .select("id")
        .single();

      // Duplicate (rule_id, session_id) — this result was already processed.
      if (eventError || !event) continue;
      if (blockedReason) continue;

      const { error: transactionError } = await db.from("reward_transactions").insert({
        user_id: input.userId,
        action_key: CHALLENGE_RESULT_ACTION_KEY,
        reference_id: event.id,
        points: rule.points,
        description: rule.name,
      });
      if (transactionError) continue;
      awarded.push({ ruleName: rule.name, points: rule.points });
    }

    return awarded;
  } catch (error) {
    console.error("challenge result reward", error);
    return [];
  }
}

/** Returns a human reason when a configured limit blocks this reward. */
async function findLimitBlock(
  rule: ChallengeResultRewardRule,
  userId: string,
  challengeId: string,
  today: string,
): Promise<string | null> {
  const db = await admin();
  const base = () =>
    db
      .from("challenge_result_reward_events")
      .select("id", { count: "exact", head: true })
      .eq("rule_id", rule.id)
      .eq("status", "awarded");

  if (rule.first_time_only) {
    const { count } = await base().eq("user_id", userId);
    if ((count ?? 0) >= 1) return "First time only — already awarded";
  }
  if (!rule.allow_repeat_after_limit) {
    if (rule.max_per_customer > 0) {
      const { count } = await base().eq("user_id", userId);
      if ((count ?? 0) >= rule.max_per_customer) return "Customer limit reached";
    }
    if (rule.max_per_day > 0) {
      const { from, to } = dhakaDayBounds(today);
      const { count } = await base().eq("user_id", userId).gte("created_at", from).lte("created_at", to);
      if ((count ?? 0) >= rule.max_per_day) return "Daily limit reached";
    }
    if (rule.max_per_challenge > 0) {
      const { count } = await base().eq("user_id", userId).eq("challenge_id", challengeId);
      if ((count ?? 0) >= rule.max_per_challenge) return "Challenge limit reached";
    }
  }
  return null;
}
