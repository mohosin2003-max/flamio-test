import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Delivery zones. The public read powers the existing checkout delivery quote
 * (`src/lib/delivery.ts`), which is unchanged — only the source of the zone
 * list moved from seed data to the database. Owner writes reuse the existing
 * `assertOwner` role check and the service-role client, exactly like coupons.
 */

type ZoneRow = Database["public"]["Tables"]["delivery_zones"]["Row"];

export interface DeliveryZoneRecord {
  /** Database id (owner screen only). */
  id: string;
  /** Stable public id stored on orders and saved addresses. */
  slug: string;
  name: string;
  deliveryCharge: number;
  minimumOrder: number;
  freeDeliveryThreshold: number | null;
  isFreeDeliveryEnabled: boolean;
  estimatedDeliveryTime: string | null;
  isActive: boolean;
  sortOrder: number;
  /** "area" keeps the original customer-picked behaviour; "radius" is matched
   * automatically from the distance to the restaurant. */
  zoneType: "area" | "radius";
  radiusMinM: number | null;
  radiusMaxM: number | null;
  /** Optional owner-set lower fee for this zone. null = not set (normal
   * charge applies); 0 = free delivery. Not yet used by checkout pricing. */
  reducedDeliveryFee: number | null;
}

const COLUMNS =
  "id,slug,name,delivery_charge,minimum_order,free_delivery_threshold,is_free_delivery_enabled,estimated_delivery_time,is_active,sort_order,zone_type,radius_min_m,radius_max_m,reduced_delivery_fee";

/** The generated types were last regenerated before this column was added
 * (applied via docs/sql/delivery_zone_reduced_fee.sql), so extend locally.
 * The casts below bypass the stale generated column map; the runtime column
 * exists in the database. */
type ZoneRowWithReducedFee = ZoneRow & { reduced_delivery_fee: number | null };

function toRecord(row: ZoneRowWithReducedFee): DeliveryZoneRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    deliveryCharge: Number(row.delivery_charge),
    minimumOrder: Number(row.minimum_order),
    freeDeliveryThreshold:
      row.free_delivery_threshold === null ? null : Number(row.free_delivery_threshold),
    isFreeDeliveryEnabled: row.is_free_delivery_enabled,
    estimatedDeliveryTime: row.estimated_delivery_time,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    zoneType: row.zone_type === "radius" ? "radius" : "area",
    radiusMinM: row.radius_min_m === null ? null : Number(row.radius_min_m),
    radiusMaxM: row.radius_max_m === null ? null : Number(row.radius_max_m),
    reducedDeliveryFee:
      row.reduced_delivery_fee === null || row.reduced_delivery_fee === undefined
        ? null
        : Number(row.reduced_delivery_fee),
  };
}

function createPublicClient(url: string, key: string) {
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        // New-format sb_ keys are opaque, not JWTs — send apikey only.
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/** Public: active delivery zones for checkout. Never throws — an empty list
 * makes the checkout fall back to the existing default delivery settings. */
export const getDeliveryZones = createServerFn({ method: "GET" }).handler(
  async (): Promise<DeliveryZoneRecord[]> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const url = process.env["SUPABASE_URL"];
    if (!key || !url) return [];

    const supabase = createPublicClient(url, key);
    const { data, error } = await supabase
      .from("delivery_zones")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("sort_order")
      .order("name");

    if (error) {
      console.error("Delivery zone read failed", error);
      return [];
    }
    return ((data ?? []) as unknown as ZoneRowWithReducedFee[]).map((row) => toRecord(row));
  },
);

export const ownerListDeliveryZones = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeliveryZoneRecord[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "delivery", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("delivery_zones")
      .select(COLUMNS)
      .order("sort_order")
      .order("name");

    if (error) {
      console.error("Delivery zone list failed", error);
      throw new Error("We couldn't load delivery zones. Please try again.");
    }
    return ((data ?? []) as unknown as ZoneRowWithReducedFee[]).map((row) => toRecord(row));
  });

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "zone"
  );
}

export const ownerSaveDeliveryZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        name: z.string().trim().min(2).max(80),
        deliveryCharge: z.number().nonnegative().max(100_000),
        minimumOrder: z.number().nonnegative().max(1_000_000),
        freeDeliveryThreshold: z.number().nonnegative().max(1_000_000).nullable(),
        isFreeDeliveryEnabled: z.boolean(),
        estimatedDeliveryTime: z.string().trim().max(60).nullable(),
        isActive: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
        zoneType: z.enum(["area", "radius"]).default("area"),
        radiusMinM: z.number().nonnegative().max(500_000).nullable().default(null),
        radiusMaxM: z.number().positive().max(500_000).nullable().default(null),
        /** Optional lower fee for this zone. null = not set; 0 = free. */
        reducedDeliveryFee: z.number().nonnegative().max(1_000_000).nullable().default(null),
      })
      .refine(
        (v) =>
          v.zoneType !== "radius" ||
          (v.radiusMaxM !== null && v.radiusMaxM > (v.radiusMinM ?? 0)),
        { message: "The end distance must be larger than the start distance." },
      )
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "delivery");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      name: data.name,
      delivery_charge: data.deliveryCharge,
      minimum_order: data.minimumOrder,
      free_delivery_threshold: data.freeDeliveryThreshold,
      is_free_delivery_enabled: data.isFreeDeliveryEnabled,
      estimated_delivery_time: data.estimatedDeliveryTime,
      is_active: data.isActive,
      sort_order: data.sortOrder,
      zone_type: data.zoneType,
      radius_min_m: data.zoneType === "radius" ? (data.radiusMinM ?? 0) : null,
      radius_max_m: data.zoneType === "radius" ? data.radiusMaxM : null,
      reduced_delivery_fee: data.reducedDeliveryFee,
    };

    if (data.id) {
      // The slug is never rewritten: existing orders and saved addresses
      // reference it.
      const { error } = await supabaseAdmin
        .from("delivery_zones")
        .update(payload as unknown as Database["public"]["Tables"]["delivery_zones"]["Update"])
        .eq("id", data.id);
      if (error) {
        console.error("Delivery zone update failed", error);
        throw new Error("We couldn't save this delivery zone. Please try again.");
      }
      return { ok: true };
    }

    const base = slugify(data.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}_${attempt + 1}`;
      const { error } = await supabaseAdmin
        .from("delivery_zones")
        .insert({ ...payload, slug } as unknown as Database["public"]["Tables"]["delivery_zones"]["Insert"]);
      if (!error) return { ok: true };
      if (error.code !== "23505") {
        console.error("Delivery zone insert failed", error);
        throw new Error("We couldn't save this delivery zone. Please try again.");
      }
    }
    throw new Error("A delivery zone with that name already exists.");
  });

export const ownerDeleteDeliveryZone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "delivery");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Orders keep their own `zone_name` / `delivery_charge` copy, so removing a
    // zone never changes an order that already happened.
    const { error } = await supabaseAdmin.from("delivery_zones").delete().eq("id", data.id);
    if (error) {
      console.error("Delivery zone delete failed", error);
      throw new Error("We couldn't delete this delivery zone. Please try again.");
    }
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Map-based delivery: restaurant origin + automatic distance pricing.  */
/* Reuses the same delivery_zones rows and restaurant_settings row.     */
/* ------------------------------------------------------------------ */

export interface DeliveryOriginRecord {
  latitude: number;
  longitude: number;
}

/** Public: the restaurant's map location, used as the centre of the radius
 * zones. Returns null when the owner hasn't set it yet. */
export const getDeliveryOrigin = createServerFn({ method: "GET" }).handler(
  async (): Promise<DeliveryOriginRecord | null> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const url = process.env["SUPABASE_URL"];
    if (!key || !url) return null;

    const supabase = createPublicClient(url, key);
    const { data, error } = await supabase
      .from("restaurant_settings")
      .select("latitude, longitude")
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (error || !data || data.latitude === null || data.longitude === null) return null;
    return { latitude: Number(data.latitude), longitude: Number(data.longitude) };
  },
);

export const ownerSaveRestaurantLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "delivery");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("restaurant_settings")
      .select("id")
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (!row) throw new Error("Restaurant settings are not set up yet.");

    const { error } = await supabaseAdmin
      .from("restaurant_settings")
      .update({ latitude: data.latitude, longitude: data.longitude })
      .eq("id", row.id);

    if (error) {
      console.error("Restaurant location update failed", error);
      throw new Error("We couldn't save the restaurant location. Please try again.");
    }
    return { ok: true };
  });

/** Public: priced preview of the delivery fee for a pinned location. The same
 * server-side maths runs again inside `placeOrder`, so this is only a preview
 * — it can never set the price that is charged. */
export const quoteDeliveryForLocation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        subtotal: z.number().nonnegative().max(10_000_000),
        discount: z.number().nonnegative().max(10_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { resolveLocationDelivery } = await import("@/lib/delivery.server");
    return resolveLocationDelivery(data);
  });
