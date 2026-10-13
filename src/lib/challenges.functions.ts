import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CHALLENGE_DIFFICULTIES,
  CHALLENGE_STATUSES,
  DETECTOR_TYPES,
  DETECTORS,
  REWARD_TYPES,
} from "@/lib/challenges";
import type {
  ChallengeDifficulty,
  ChallengeRewardType,
  ChallengeStatus,
  ChallengeWinnerCard,
  DetectorType,
  PublicChallenge,
} from "@/lib/challenges";

/* ------------------------------- customer ------------------------------- */

export const listMyChallenges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const {
      CHALLENGE_COLUMNS,
      computePlayAccess,
      countDailyWinners,
      effectiveConfig,
      getChallengeSettings,
      isWindowOpen,
    } = await import("@/lib/challenges.server");
    const settings = await getChallengeSettings();
    if (!settings.is_enabled) {
      return { enabled: false, challenges: [] as PublicChallenge[] };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("challenges")
      .select(CHALLENGE_COLUMNS)
      .in("status", ["active", "scheduled"])
      .order("sort_order");

    const challenges: PublicChallenge[] = [];
    for (const raw of rows ?? []) {
      const challenge = raw as unknown as Parameters<typeof computePlayAccess>[1];
      const detector = DETECTORS[challenge.detector_type as DetectorType];
      const open = isWindowOpen(challenge);
      const playable = Boolean(detector?.implemented) && challenge.status === "active" && open;
      const [access, dailyWinners] = await Promise.all([
        computePlayAccess(context.userId, challenge),
        countDailyWinners(challenge.id),
      ]);
      challenges.push({
        id: challenge.id,
        slug: challenge.slug,
        name: challenge.name,
        description: challenge.description,
        instructions: challenge.instructions,
        gameType: challenge.game_type,
        detectorType: challenge.detector_type as DetectorType,
        iconEmoji: challenge.icon_emoji,
        difficulty: challenge.difficulty as ChallengeDifficulty,
        status: challenge.status as ChallengeStatus,
        attemptsPerSession: challenge.attempts_per_session,
        requiredScore: Number(challenge.required_score),
        timeLimitSeconds: challenge.time_limit_seconds,
        difficultyConfig: effectiveConfig(challenge),
        winningCondition: (challenge.winning_condition ?? {}) as Record<string, number | string>,
        rewardType: challenge.reward_type as ChallengeRewardType,
        rewardName: challenge.reward_name,
        rewardQuantity: challenge.reward_quantity,
        dailyWinnerLimit: challenge.daily_winner_limit,
        dailyWinners,
        playable,
        unavailableReason: !detector?.implemented
          ? (detector?.note ?? "This challenge isn't playable yet.")
          : !open
            ? "Outside this challenge's schedule."
            : challenge.status !== "active"
              ? "Coming soon."
              : null,
        access,
      });
    }

    return { enabled: true, challenges };
  });

export const startChallengePlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ challengeId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertRestaurantOpen } = await import("@/lib/opening-hours.server");
    await assertRestaurantOpen();
    const { CHALLENGE_COLUMNS, openSession } = await import("@/lib/challenges.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("challenges")
      .select(CHALLENGE_COLUMNS)
      .eq("id", data.challengeId)
      .maybeSingle();
    if (!row) throw new Error("Challenge not found.");
    return openSession(context.userId, row as never);
  });

export const finishChallengePlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), score: z.number().min(0).max(100_000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertRestaurantOpen } = await import("@/lib/opening-hours.server");
    await assertRestaurantOpen();
    const { resolveSession } = await import("@/lib/challenges.server");
    return resolveSession(context.userId, data.sessionId, data.score);
  });

export const listMyChallengeWins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("challenge_winners")
      .select("id, reward_name, reward_quantity, coupon_code, claim_status, won_at, challenges(name)")
      .order("won_at", { ascending: false })
      .limit(20);
    return (data ?? []).map((row) => {
      const challenge = Array.isArray(row.challenges) ? row.challenges[0] : row.challenges;
      return {
        id: row.id,
        challengeName: challenge?.name ?? "Challenge",
        rewardName: row.reward_name,
        rewardQuantity: row.reward_quantity,
        couponCode: row.coupon_code,
        claimStatus: row.claim_status,
        wonAt: row.won_at,
      };
    });
  });

export const claimChallengeWin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ winnerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated } = await supabaseAdmin
      .from("challenge_winners")
      .update({ claim_status: "claimed" })
      .eq("id", data.winnerId)
      .eq("user_id", context.userId)
      .eq("claim_status", "pending")
      .select("id");
    if (!updated || updated.length === 0) throw new Error("This reward is already claimed.");
    return { ok: true };
  });

/** Winner ticker feed: display name and photo only, never contact details. */
export const listWinnerTicker = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getChallengeSettings } = await import("@/lib/challenges.server");
    const settings = await getChallengeSettings();
    if (!settings.is_enabled || !settings.ticker_enabled) {
      return { enabled: false, durationSeconds: 4, winners: [] as ChallengeWinnerCard[] };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("challenge_winners")
      .select("id, reward_name, won_at, user_id, challenges(name, slug)")
      .eq("is_hidden", false)
      .order("won_at", { ascending: false })
      .limit(Math.max(1, settings.ticker_max_winners));

    const rows = data ?? [];
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        const first = (profile.full_name ?? "").trim().split(" ")[0];
        names.set(profile.id, first || "A Flamio fan");
      }
    }

    const winners: ChallengeWinnerCard[] = rows.map((row) => {
      const challenge = Array.isArray(row.challenges) ? row.challenges[0] : row.challenges;
      return {
        id: row.id,
        challengeName: challenge?.name ?? "Challenge",
        challengeSlug: challenge?.slug ?? "",
        rewardName: row.reward_name,
        displayName: names.get(row.user_id) ?? "A Flamio fan",
        avatarUrl: null,
        wonAt: row.won_at,
      };
    });

    return {
      enabled: true,
      durationSeconds: Math.max(2, settings.ticker_duration_seconds),
      winners,
    };
  });

/* --------------------------------- owner -------------------------------- */

async function assertChallengeAccess(userId: string, level: "view" | "manage" = "manage") {
  const { assertPermission } = await import("@/lib/owner.server");
  await assertPermission(userId, "challenges", level);
}

export const ownerListChallenges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertChallengeAccess(context.userId, "view");
    const { CHALLENGE_COLUMNS, getChallengeSettings } = await import("@/lib/challenges.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const [settings, challengesResult, winnersResult, dailyResult] = await Promise.all([
      getChallengeSettings(),
      supabaseAdmin.from("challenges").select(CHALLENGE_COLUMNS).order("sort_order"),
      supabaseAdmin
        .from("challenge_winners")
        .select(
          "id, challenge_id, user_id, reward_name, reward_quantity, coupon_code, claim_status, is_hidden, won_at, challenges(name)",
        )
        .order("won_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("challenge_winners")
        .select("challenge_id")
        .gte("won_at", since.toISOString()),
    ]);

    const dailyCounts = new Map<string, number>();
    for (const row of dailyResult.data ?? []) {
      dailyCounts.set(row.challenge_id, (dailyCounts.get(row.challenge_id) ?? 0) + 1);
    }

    const winnerRows = winnersResult.data ?? [];
    const userIds = [...new Set(winnerRows.map((row) => row.user_id))];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const profile of profiles ?? []) names.set(profile.id, profile.full_name ?? "Customer");
    }

    // Total plays consumed per challenge, for the Play Access overview.
    const { data: playStates } = await supabaseAdmin
      .from("challenge_play_state")
      .select("challenge_id, plays_used, user_id");
    const playTotals = new Map<string, { plays: number; customers: number }>();
    for (const row of playStates ?? []) {
      const entry = playTotals.get(row.challenge_id) ?? { plays: 0, customers: 0 };
      entry.plays += row.plays_used;
      entry.customers += 1;
      playTotals.set(row.challenge_id, entry);
    }

    return {
      settings: {
        id: settings.id,
        isEnabled: settings.is_enabled,
        tickerEnabled: settings.ticker_enabled,
        tickerMaxWinners: settings.ticker_max_winners,
        tickerDurationSeconds: settings.ticker_duration_seconds,
        winnerRetentionDays: settings.winner_retention_days,
        autoCleanupEnabled: settings.auto_cleanup_enabled,
      },
      challenges: (challengesResult.data ?? []).map((row) => {
        const totals = playTotals.get(row.id) ?? { plays: 0, customers: 0 };
        return {
          ...row,
          dailyWinners: dailyCounts.get(row.id) ?? 0,
          totalPlays: totals.plays,
          totalPlayers: totals.customers,
          detectorImplemented: Boolean(DETECTORS[row.detector_type as DetectorType]?.implemented),
          detectorNote: DETECTORS[row.detector_type as DetectorType]?.note ?? null,
        };
      }),
      winners: winnerRows.map((row) => {
        const challenge = Array.isArray(row.challenges) ? row.challenges[0] : row.challenges;
        return {
          id: row.id,
          challengeId: row.challenge_id,
          challengeName: challenge?.name ?? "Challenge",
          customerName: names.get(row.user_id) ?? "Customer",
          rewardName: row.reward_name,
          rewardQuantity: row.reward_quantity,
          couponCode: row.coupon_code,
          claimStatus: row.claim_status,
          isHidden: row.is_hidden,
          wonAt: row.won_at,
        };
      }),
    };
  });


const challengeInput = z.object({
  id: z.string().uuid().nullable(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes."),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullable(),
  instructions: z.string().trim().max(1000).nullable(),
  gameType: z.string().trim().min(2).max(40),
  detectorType: z.enum(DETECTOR_TYPES),
  iconEmoji: z.string().trim().min(1).max(8),
  difficulty: z.enum(CHALLENGE_DIFFICULTIES),
  status: z.enum(CHALLENGE_STATUSES),
  startsOn: z.string().trim().min(1).nullable(),
  endsOn: z.string().trim().min(1).nullable(),
  dailyStartTime: z.string().trim().min(1).nullable(),
  dailyEndTime: z.string().trim().min(1).nullable(),
  attemptsPerSession: z.number().int().min(1).max(20),
  requiredScore: z.number().min(0).max(100_000),
  requiredAccuracy: z.number().min(0).max(100).nullable(),
  timeLimitSeconds: z.number().int().min(0).max(3600).nullable(),
  winningCondition: z.record(z.string(), z.union([z.number(), z.string()])),
  difficultyConfig: z.record(z.string(), z.number()),
  rewardType: z.enum(REWARD_TYPES),
  rewardName: z.string().trim().min(2).max(80),
  rewardQuantity: z.number().int().min(1).max(20),
  rewardCouponId: z.string().uuid().nullable(),
  rewardPoints: z.number().int().min(0).max(100_000),
  basePlays: z.number().int().min(0).max(50),
  maxStoredPlays: z.number().int().min(1).max(50),
  maxPlaysPerCustomer: z.number().int().min(0).max(10_000),
  cooldownMinutes: z.number().int().min(0).max(100_000),
  refillEnabled: z.boolean(),
  refillIntervalMinutes: z.number().int().min(1).max(1_000_000),
  refillAmount: z.number().int().min(1).max(50),
  orderUnlockEnabled: z.boolean(),
  orderMinAmount: z.number().min(0).max(1_000_000),
  orderUnlockPlays: z.number().int().min(1).max(50),
  orderUnlockMax: z.number().int().min(0).max(1000),
  orderUnlockStack: z.boolean(),
  orderRequiredStatus: z.enum(["completed", "ready", "out_for_delivery", "confirmed"]),
  referralUnlockEnabled: z.boolean(),
  referralRequiredCount: z.number().int().min(1).max(1000),
  referralUnlockPlays: z.number().int().min(1).max(50),
  referralUnlockMax: z.number().int().min(0).max(1000),
  referralCooldownHours: z.number().int().min(0).max(10_000),
  referralVerification: z.enum(["approved_claim", "manual_review"]),
  dailyWinnerLimit: z.number().int().min(0).max(10_000),
  totalWinnerLimit: z.number().int().min(0).max(1_000_000),
  maxWinsPerCustomer: z.number().int().min(0).max(1000),
  sortOrder: z.number().int().min(0).max(1000),
});

export type ChallengeInput = z.infer<typeof challengeInput>;

export const ownerSaveChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => challengeInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = {
      slug: data.slug,
      name: data.name,
      description: data.description,
      instructions: data.instructions,
      game_type: data.gameType,
      detector_type: data.detectorType,
      icon_emoji: data.iconEmoji,
      difficulty: data.difficulty,
      status: data.status,
      starts_on: data.startsOn,
      ends_on: data.endsOn,
      daily_start_time: data.dailyStartTime,
      daily_end_time: data.dailyEndTime,
      attempts_per_session: data.attemptsPerSession,
      required_score: data.requiredScore,
      required_accuracy: data.requiredAccuracy,
      time_limit_seconds: data.timeLimitSeconds,
      winning_condition: data.winningCondition,
      difficulty_config: data.difficultyConfig,
      reward_type: data.rewardType,
      reward_name: data.rewardName,
      reward_quantity: data.rewardQuantity,
      reward_coupon_id: data.rewardCouponId,
      reward_points: data.rewardPoints,
      base_plays: data.basePlays,
      max_stored_plays: data.maxStoredPlays,
      max_plays_per_customer: data.maxPlaysPerCustomer,
      cooldown_minutes: data.cooldownMinutes,
      refill_enabled: data.refillEnabled,
      refill_interval_minutes: data.refillIntervalMinutes,
      refill_amount: data.refillAmount,
      order_unlock_enabled: data.orderUnlockEnabled,
      order_min_amount: data.orderMinAmount,
      order_unlock_plays: data.orderUnlockPlays,
      order_unlock_max: data.orderUnlockMax,
      order_unlock_stack: data.orderUnlockStack,
      order_required_status: data.orderRequiredStatus,
      referral_unlock_enabled: data.referralUnlockEnabled,
      referral_required_count: data.referralRequiredCount,
      referral_unlock_plays: data.referralUnlockPlays,
      referral_unlock_max: data.referralUnlockMax,
      referral_cooldown_hours: data.referralCooldownHours,
      referral_verification: data.referralVerification,
      daily_winner_limit: data.dailyWinnerLimit,
      total_winner_limit: data.totalWinnerLimit,
      max_wins_per_customer: data.maxWinsPerCustomer,
      sort_order: data.sortOrder,
    };

    if (data.id) {
      const { error } = await supabaseAdmin.from("challenges").update(row).eq("id", data.id);
      if (error) throw new Error("We couldn't save this challenge.");
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("challenges")
      .insert(row)
      .select("id")
      .single();
    if (error?.code === "23505") throw new Error("A challenge with this slug already exists.");
    if (error || !inserted) throw new Error("We couldn't create this challenge.");
    return { ok: true, id: inserted.id };
  });

export const ownerSetChallengeStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(CHALLENGE_STATUSES) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("challenges")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error("We couldn't update this challenge.");
    return { ok: true };
  });

export const ownerDuplicateChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("challenges")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Challenge not found.");
    const copy = { ...(row as Record<string, unknown>) };
    delete copy["id"];
    delete copy["created_at"];
    delete copy["updated_at"];
    copy["slug"] = `${String(copy["slug"]).slice(0, 45)}-copy-${Math.random().toString(36).slice(2, 6)}`;
    copy["name"] = `${String(copy["name"])} (copy)`;
    copy["status"] = "draft";
    const { error } = await supabaseAdmin.from("challenges").insert(copy as never);
    if (error) throw new Error("We couldn't duplicate this challenge.");
    return { ok: true };
  });

export const ownerDeleteChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("challenges").delete().eq("id", data.id);
    if (error) throw new Error("We couldn't delete this challenge.");
    return { ok: true };
  });

export const ownerUpdateWinner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["hide", "show", "delete", "mark_claimed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "delete") {
      // Deletes only the winner record — never the customer, profile or orders.
      const { error } = await supabaseAdmin.from("challenge_winners").delete().eq("id", data.id);
      if (error) throw new Error("We couldn't delete this winner record.");
      return { ok: true };
    }
    const patch =
      data.action === "mark_claimed"
        ? { claim_status: "claimed" }
        : { is_hidden: data.action === "hide" };
    const { error } = await supabaseAdmin.from("challenge_winners").update(patch).eq("id", data.id);
    if (error) throw new Error("We couldn't update this winner record.");
    return { ok: true };
  });

export const ownerCleanupWinners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(60), z.literal(90)]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { cleanupWinners } = await import("@/lib/challenges.server");
    const removed = await cleanupWinners(data.days);
    return { removed };
  });

export const ownerSaveChallengeSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        isEnabled: z.boolean(),
        tickerEnabled: z.boolean(),
        tickerMaxWinners: z.number().int().min(1).max(50),
        tickerDurationSeconds: z.number().int().min(2).max(30),
        winnerRetentionDays: z.union([z.literal(7), z.literal(30), z.literal(60), z.literal(90)]),
        autoCleanupEnabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertChallengeAccess(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("challenge_settings")
      .update({
        is_enabled: data.isEnabled,
        ticker_enabled: data.tickerEnabled,
        ticker_max_winners: data.tickerMaxWinners,
        ticker_duration_seconds: data.tickerDurationSeconds,
        winner_retention_days: data.winnerRetentionDays,
        auto_cleanup_enabled: data.autoCleanupEnabled,
      })
      .eq("id", data.id);
    if (error) throw new Error("We couldn't save challenge settings.");
    if (data.autoCleanupEnabled) {
      const { cleanupWinners } = await import("@/lib/challenges.server");
      await cleanupWinners(data.winnerRetentionDays);
    }
    return { ok: true };
  });
