import { validateRewardSettings, type RewardSettings } from "./burger-boost-reward";

/** Inactive schema contract: generated database types still describe the applied schema. */
export type RewardSettingsTransport = {
  schema(name: "burger_boost"): {
    rpc(
      name: "get_owner_settings" | "update_settings" | "set_game_enabled",
      args?: ReturnType<typeof ownerSettingsArgs> | { p_enabled: boolean },
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

/** Only this scalar is public; never spread settings or allocation RPC rows. */
export function publicRewardSettings(value: unknown): { ownerMax: number } {
  return {
    ownerMax:
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 50 ? value : 0,
  };
}

export function ownerSettingsArgs(input: unknown) {
  const check = validateRewardSettings(input);
  if (!check.ok) throw new Error(check.errors.join(" "));
  const s = check.settings;
  return {
    p_owner_max: s.ownerMax,
    p_partial_max: s.partialMax,
    p_full_limit: s.dailyFullLimit,
    p_partial_limit: s.dailyPartialLimit,
    p_min_order: s.minOrderBdt,
    p_gate_count: s.gateCount,
  };
}

export function assertRewardSettingsOwner(roles: readonly { role: string }[]) {
  if (!roles.some((row) => row.role === "owner")) throw new Error("Forbidden");
}

export type OwnerRewardSettings = {
  available: boolean;
  /** Strict: only a literal boolean true from the server counts as ON. */
  gameEnabled: boolean;
  settings: RewardSettings | null;
  claimExpiryMinutes: number;
  usage: {
    date: string;
    fullUsed: number;
    fullReserved: number;
    partialUsed: number;
    partialReserved: number;
  } | null;
};

export const unavailableOwnerSettings: OwnerRewardSettings = {
  available: false,
  gameEnabled: false,
  settings: null,
  claimExpiryMinutes: 30,
  usage: null,
};

export function parseOwnerRewardSettings(value: unknown): OwnerRewardSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailableOwnerSettings;
  const row = value as Record<string, unknown>;
  const check = validateRewardSettings({
    ownerMax: row.owner_max_discount,
    partialMax: row.partial_max_discount,
    dailyFullLimit: row.daily_full_limit,
    dailyPartialLimit: row.daily_partial_limit,
    minOrderBdt: row.min_order_bdt,
    gateCount: row.gate_count,
  });
  const counters = [row.full_used, row.full_reserved, row.partial_used, row.partial_reserved];
  if (
    !check.ok ||
    row.claim_expiry_minutes !== 30 ||
    typeof row.dhaka_date !== "string" ||
    !counters.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
  ) {
    return unavailableOwnerSettings;
  }
  return {
    available: true,
    gameEnabled: row.game_enabled === true,
    settings: check.settings,
    claimExpiryMinutes: 30,
    usage: {
      date: row.dhaka_date,
      fullUsed: Number(row.full_used),
      fullReserved: Number(row.full_reserved),
      partialUsed: Number(row.partial_used),
      partialReserved: Number(row.partial_reserved),
    },
  };
}

/** Strict input for the Owner game toggle: exactly `{ enabled: boolean }`. */
export function gameEnabledArgs(input: unknown): { p_enabled: boolean } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid input.");
  const keys = Object.keys(input);
  const enabled = (input as Record<string, unknown>)["enabled"];
  if (keys.length !== 1 || keys[0] !== "enabled" || typeof enabled !== "boolean")
    throw new Error("Invalid input.");
  return { p_enabled: enabled };
}

/**
 * Owner-only game toggle. Role check happens before the privileged transport
 * is loaded; the RPC changes only game_enabled + updated_at.
 */
export async function setGameEnabledAsOwner(deps: {
  loadRoles: () => PromiseLike<{ data: { role: string }[] | null; error: unknown }>;
  loadTransport: () => Promise<RewardSettingsTransport>;
  args: { p_enabled: boolean };
}): Promise<OwnerRewardSettings> {
  const { data: roles, error: roleError } = await deps.loadRoles();
  if (roleError) throw new Error("Unable to verify Owner access.");
  assertRewardSettingsOwner(roles ?? []);
  const transport = await deps.loadTransport();
  const { data, error } = await transport
    .schema("burger_boost")
    .rpc("set_game_enabled", { p_enabled: deps.args.p_enabled });
  if (error)
    throw new Error(
      "Game status could not be changed. The approved database update may still be pending.",
    );
  const result = parseOwnerRewardSettings(data);
  if (!result.available) throw new Error("Game status returned an invalid response.");
  return result;
}
