import type { HoursSettings } from "@/lib/opening-hours";

type Row = Record<string, unknown>;

export function hoursFromRow(row: Row | null | undefined): HoursSettings {
  const r = row ?? {};
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    isOpen: r["is_open"] !== false,
    autoHours: r["auto_hours_enabled"] !== false,
    opensAt: (r["opens_at"] as string | null) ?? null,
    closesAt: (r["closes_at"] as string | null) ?? null,
    scheduledEnabled: r["scheduled_orders_enabled"] === true,
    maxAdvanceDays: num(r["scheduled_max_advance_days"], 3),
    paymentRequired: r["scheduled_payment_required"] === true,
    prepMinutes: num(r["scheduled_prep_minutes"], 30),
    slotMinutes: num(r["scheduled_slot_minutes"], 30),
    allowWhileClosed: r["scheduled_allow_while_closed"] !== false,
  };
}

export const HOURS_COLUMNS =
  "is_open, opens_at, closes_at, auto_hours_enabled, scheduled_orders_enabled, scheduled_max_advance_days, scheduled_payment_required, scheduled_prep_minutes, scheduled_slot_minutes, scheduled_allow_while_closed";

/** Authoritative settings read (service role; server-only). */
export async function loadHoursSettings(): Promise<HoursSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as unknown as {
    from: (t: string) => { select: (c: string) => { order: (c: string) => { limit: (n: number) => { maybeSingle: () => Promise<{ data: Row | null; error: unknown }> } } } };
  })
    .from("restaurant_settings")
    .select(HOURS_COLUMNS)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Opening hours load failed", error);
    throw new Error("We couldn't check opening hours. Please try again.");
  }
  return hoursFromRow(data);
}

export async function assertRestaurantOpen(message = "Games are available when the restaurant is open.") {
  const { isOpenAt } = await import("@/lib/opening-hours");
  const settings = await loadHoursSettings();
  if (!isOpenAt(settings)) throw new Error(message);
}
