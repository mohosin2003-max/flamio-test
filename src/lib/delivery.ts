import { queryOptions } from "@tanstack/react-query";

import { deliverySettings, deliveryZones } from "@/data/delivery";
import {
  getDeliveryOrigin,
  getDeliveryZones,
  type DeliveryOriginRecord,
} from "@/lib/delivery.functions";
import type {
  DeliveryQuote,
  DeliverySettings,
  DeliveryZone,
  FulfillmentType,
} from "@/types/menu";

/**
 * Single read layer for delivery configuration. Zones now come from the
 * database (owner-managed); the global fallback settings and the quote maths
 * below are unchanged. If the read fails or returns nothing, the original
 * seed zones are used so checkout can never lose its delivery pricing.
 */
export const deliveryQueryOptions = () =>
  queryOptions({
    queryKey: ["delivery-settings"],
    queryFn: async () => {
      let zones: DeliveryZone[] = [];
      let origin: DeliveryOriginRecord | null = null;
      try {
        const [rows, originRow] = await Promise.all([getDeliveryZones(), getDeliveryOrigin()]);
        origin = originRow;
        zones = rows.map((z) => ({
          // Orders and saved addresses store the slug as the zone id.
          id: z.slug,
          name: z.name,
          deliveryCharge: z.deliveryCharge,
          minimumOrder: z.minimumOrder,
          freeDeliveryThreshold: z.freeDeliveryThreshold,
          isFreeDeliveryEnabled: z.isFreeDeliveryEnabled,
          estimatedDeliveryTime: z.estimatedDeliveryTime,
          isActive: z.isActive,
          zoneType: z.zoneType,
          radiusMinM: z.radiusMinM,
          radiusMaxM: z.radiusMaxM,
          reducedDeliveryFee: z.reducedDeliveryFee,
        }));
      } catch (error) {
        console.error("Delivery zones unavailable, using defaults", error);
      }

      if (zones.length === 0) zones = deliveryZones.filter((z) => z.isActive);

      return { settings: deliverySettings, zones: zones.filter((z) => z.isActive), origin };
    },
    staleTime: 5 * 60 * 1000,
  });

export function resolveZone(zones: DeliveryZone[], zoneId: string | null): DeliveryZone | null {
  return zones.find((z) => z.id === zoneId) ?? null;
}

export function quoteDelivery(params: {
  settings: DeliverySettings;
  zone: DeliveryZone | null;
  fulfillment: FulfillmentType;
  subtotal: number;
  discount?: number;
}): DeliveryQuote {
  const { settings, zone, fulfillment, subtotal } = params;
  const discount = params.discount ?? 0;

  if (fulfillment === "pickup") {
    return {
      charge: 0,
      isFree: true,
      freeReason: "pickup",
      minimumOrder: 0,
      meetsMinimumOrder: true,
      freeDeliveryThreshold: null,
      amountToFreeDelivery: null,
      estimatedTime: null,
    };
  }

  const baseCharge = zone?.deliveryCharge ?? settings.defaultDeliveryCharge;
  const minimumOrder = zone?.minimumOrder ?? settings.defaultMinimumOrder;
  const freeEnabled = zone
    ? zone.isFreeDeliveryEnabled && settings.isFreeDeliveryEnabled
    : settings.isFreeDeliveryEnabled;
  const threshold = zone?.freeDeliveryThreshold ?? settings.freeDeliveryThreshold;
  const payable = Math.max(subtotal - discount, 0);

  const reachedThreshold = freeEnabled && threshold !== null && payable >= threshold;
  // Threshold reached: a configured reduced fee (> 0) replaces the normal fee;
  // unset or 0 keeps free delivery exactly as before.
  const reducedFee = zone?.reducedDeliveryFee ?? null;
  const reducedCharge = reachedThreshold && reducedFee !== null && reducedFee > 0 ? reducedFee : null;
  const qualifiesFree = reachedThreshold && reducedCharge === null;

  return {
    charge: reducedCharge ?? (qualifiesFree ? 0 : baseCharge),
    isFree: qualifiesFree,
    freeReason: qualifiesFree ? "threshold" : null,
    minimumOrder,
    meetsMinimumOrder: payable >= minimumOrder,
    freeDeliveryThreshold: freeEnabled ? threshold : null,
    amountToFreeDelivery:
      freeEnabled && threshold !== null && payable < threshold ? threshold - payable : null,
    estimatedTime: zone?.estimatedDeliveryTime ?? settings.defaultEstimatedDeliveryTime,
  };
}
