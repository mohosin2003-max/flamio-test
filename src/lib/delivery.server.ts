import { deliverySettings } from "@/data/delivery";
import { quoteDelivery } from "@/lib/delivery";
import { haversineMeters, isValidLatLng, pickRadiusZone, radiusZones } from "@/lib/geo";
import type { DeliveryZone } from "@/types/menu";

/**
 * Authoritative delivery pricing for a pinned map location. The browser uses
 * the same maths for a live preview, but this module is what decides the fee
 * that is actually stored on the order — the customer can never send their
 * own charge.
 */

export interface LocationDeliveryResult {
  /** Radius zones configured at all? When false, the original area-based
   * checkout behaviour applies unchanged. */
  radiusMode: boolean;
  available: boolean;
  distanceM: number | null;
  zoneSlug: string | null;
  zoneName: string | null;
  charge: number;
  estimatedTime: string | null;
  minimumOrder: number;
  meetsMinimumOrder: boolean;
  freeDeliveryThreshold: number | null;
  amountToFreeDelivery: number | null;
  isFree: boolean;
  /** Plain-language reason when delivery is not available. */
  message: string | null;
}

export interface DeliveryOrigin {
  latitude: number;
  longitude: number;
}

export async function loadDeliveryContext(): Promise<{
  origin: DeliveryOrigin | null;
  zones: DeliveryZone[];
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: settings }, { data: rows }] = await Promise.all([
    supabaseAdmin
      .from("restaurant_settings")
      .select("latitude, longitude")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("delivery_zones")
      .select(
        "slug,name,delivery_charge,minimum_order,free_delivery_threshold,is_free_delivery_enabled,estimated_delivery_time,is_active,zone_type,radius_min_m,radius_max_m,reduced_delivery_fee",
      )
      .eq("is_active", true),
  ]);

  const origin =
    settings && settings.latitude !== null && settings.longitude !== null
      ? { latitude: Number(settings.latitude), longitude: Number(settings.longitude) }
      : null;

  // reduced_delivery_fee is not in the generated types yet; read it locally.
  const zones: DeliveryZone[] = ((rows ?? []) as unknown as Array<
    import("@/integrations/supabase/types").Database["public"]["Tables"]["delivery_zones"]["Row"] & { reduced_delivery_fee: number | string | null }
  >).map((r) => ({
    id: r.slug,
    name: r.name,
    deliveryCharge: Number(r.delivery_charge),
    minimumOrder: Number(r.minimum_order),
    freeDeliveryThreshold:
      r.free_delivery_threshold === null ? null : Number(r.free_delivery_threshold),
    isFreeDeliveryEnabled: r.is_free_delivery_enabled,
    estimatedDeliveryTime: r.estimated_delivery_time,
    isActive: r.is_active,
    zoneType: r.zone_type === "radius" ? "radius" : "area",
    radiusMinM: r.radius_min_m === null ? null : Number(r.radius_min_m),
    radiusMaxM: r.radius_max_m === null ? null : Number(r.radius_max_m),
    reducedDeliveryFee:
      r.reduced_delivery_fee === null || r.reduced_delivery_fee === undefined
        ? null
        : Number(r.reduced_delivery_fee),
  }));

  return { origin, zones };
}

export async function resolveLocationDelivery(params: {
  latitude: number | null;
  longitude: number | null;
  subtotal: number;
  discount: number;
}): Promise<LocationDeliveryResult> {
  const { origin, zones } = await loadDeliveryContext();
  const hasRadiusZones = radiusZones(zones).length > 0;

  const base = (over: Partial<LocationDeliveryResult> = {}): LocationDeliveryResult => ({
    radiusMode: hasRadiusZones && origin !== null,
    available: true,
    distanceM: null,
    zoneSlug: null,
    zoneName: null,
    charge: 0,
    estimatedTime: null,
    minimumOrder: 0,
    meetsMinimumOrder: true,
    freeDeliveryThreshold: null,
    amountToFreeDelivery: null,
    isFree: false,
    message: null,
    ...over,
  });

  // No distance rings configured (or no restaurant location set) — the
  // existing area-based pricing stays in charge.
  if (!hasRadiusZones || !origin) return base({ radiusMode: false });

  const point = { latitude: params.latitude ?? NaN, longitude: params.longitude ?? NaN };
  if (!isValidLatLng(point)) {
    return base({
      available: false,
      message: "Please choose your delivery location on the map.",
    });
  }

  const distanceM = haversineMeters(origin, point);
  const zone = pickRadiusZone(zones, distanceM);

  if (!zone) {
    return base({
      available: false,
      distanceM,
      message: "Sorry, we don't deliver to that location yet.",
    });
  }

  const quote = quoteDelivery({
    settings: deliverySettings,
    zone,
    fulfillment: "delivery",
    subtotal: params.subtotal,
    discount: params.discount,
  });

  return base({
    distanceM,
    zoneSlug: zone.id,
    zoneName: zone.name,
    charge: quote.charge,
    estimatedTime: quote.estimatedTime,
    minimumOrder: quote.minimumOrder,
    meetsMinimumOrder: quote.meetsMinimumOrder,
    freeDeliveryThreshold: quote.freeDeliveryThreshold,
    amountToFreeDelivery: quote.amountToFreeDelivery,
    isFree: quote.isFree,
  });
}
