/**
 * Client-safe challenge engine vocabulary.
 *
 * The engine is configuration driven: a challenge row carries a `detector_type`
 * (which gameplay module runs and how a win is judged) plus JSON config blocks.
 * Adding a future game means registering one more detector here and one more
 * gameplay component — no changes to the play-access, reward or winner logic.
 */

export const CHALLENGE_STATUSES = ["draft", "active", "paused", "scheduled", "archived"] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const CHALLENGE_DIFFICULTIES = ["easy", "normal", "hard", "expert", "custom"] as const;
export type ChallengeDifficulty = (typeof CHALLENGE_DIFFICULTIES)[number];

export const REWARD_TYPES = ["free_item", "coupon", "points", "custom"] as const;
export type ChallengeRewardType = (typeof REWARD_TYPES)[number];

/** Detectors that are actually implemented today. */
export const DETECTOR_TYPES = [
  "reaction_game",
  "timing_game",
  "memory_game",
  "avoid_game",
  "sequence_game",
  "stack_game",
  "dice_detector",
  "coin_detector",
  "bottle_flip_detector",
] as const;
export type DetectorType = (typeof DETECTOR_TYPES)[number];

/**
 * Detector capability map. `implemented: false` means we have no honest way to
 * judge the outcome yet (camera detection), so those challenges cannot be
 * played and the owner dashboard says so plainly.
 */
export const DETECTORS: Record<
  DetectorType,
  { label: string; implemented: boolean; judged: "server" | "client_score"; note?: string }
> = {
  reaction_game: { label: "Reaction mini-game", implemented: true, judged: "client_score" },
  timing_game: { label: "Timing mini-game", implemented: true, judged: "client_score" },
  memory_game: { label: "Memory mini-game", implemented: true, judged: "client_score" },
  avoid_game: { label: "Avoid-the-bomb mini-game", implemented: true, judged: "client_score" },
  sequence_game: { label: "Sequence mini-game", implemented: true, judged: "client_score" },
  stack_game: { label: "Stacking mini-game", implemented: true, judged: "client_score" },
  dice_detector: { label: "Dice roll (server rolled)", implemented: true, judged: "server" },
  coin_detector: { label: "Coin toss (server tossed)", implemented: true, judged: "server" },
  bottle_flip_detector: {
    label: "Bottle flip (camera)",
    implemented: false,
    judged: "server",
    note: "Camera-based flip detection is not implemented. This challenge cannot be played until a verified detection or staff-review method exists.",
  },
};

export type ChallengeUnlockMethod =
  | { kind: "refill"; plays: number; intervalMinutes: number; nextAt: string | null }
  | { kind: "order"; plays: number; minAmount: number; requiredStatus: string }
  | { kind: "referral"; plays: number; required: number; verified: number; verification: string };

export type ChallengePlayAccess = {
  available: number;
  playsUsed: number;
  maxStored: number;
  lockedReason: string | null;
  cooldownUntil: string | null;
  nextRefillAt: string | null;
  unlockMethods: ChallengeUnlockMethod[];
};

export type PublicChallenge = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  instructions: string | null;
  gameType: string;
  detectorType: DetectorType;
  iconEmoji: string;
  difficulty: ChallengeDifficulty;
  status: ChallengeStatus;
  attemptsPerSession: number;
  requiredScore: number;
  timeLimitSeconds: number | null;
  difficultyConfig: Record<string, number>;
  winningCondition: Record<string, number | string>;
  rewardType: ChallengeRewardType;
  rewardName: string;
  rewardQuantity: number;
  dailyWinnerLimit: number;
  dailyWinners: number;
  playable: boolean;
  unavailableReason: string | null;
  access: ChallengePlayAccess;
};

export type ChallengeWinnerCard = {
  id: string;
  challengeName: string;
  challengeSlug: string;
  rewardName: string;
  displayName: string;
  avatarUrl: string | null;
  wonAt: string;
};

/** Difficulty presets scale a detector's config without any code change. */
export const DIFFICULTY_PRESETS: Record<
  Exclude<ChallengeDifficulty, "custom">,
  Record<string, number>
> = {
  easy: { multiplier: 1.35 },
  normal: { multiplier: 1 },
  hard: { multiplier: 0.8 },
  expert: { multiplier: 0.6 },
};

export function formatCountdown(target: string | null): string | null {
  if (!target) return null;
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function difficultyLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
