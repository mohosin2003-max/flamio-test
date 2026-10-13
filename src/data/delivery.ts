import type { DeliverySettings, DeliveryZone } from "@/types/menu";

/**
 * Delivery configuration. Every value here is owner-editable in a later phase
 * (Owner Dashboard writes the same shape to the database). Nothing about
 * delivery pricing may be hard-coded in components — always read it through
 * `src/lib/delivery.ts`.
 */

export const deliveryZones: DeliveryZone[] = [
  {
    id: "kishoreganj_sadar",
    name: "Kishoreganj Sadar",
    deliveryCharge: 50,
    minimumOrder: 0,
    freeDeliveryThreshold: 500,
    isFreeDeliveryEnabled: true,
    estimatedDeliveryTime: "30–45 min",
    isActive: true,
    zoneType: "area",
    radiusMinM: null,
    radiusMaxM: null,
  },
];

export const deliverySettings: DeliverySettings = {
  isDeliveryEnabled: true,
  isPickupEnabled: true,
  /** Fallback when no zone is selected / zone has no override. */
  defaultDeliveryCharge: 50,
  defaultMinimumOrder: 0,
  isFreeDeliveryEnabled: true,
  freeDeliveryThreshold: 500,
  defaultEstimatedDeliveryTime: "30–45 min",
  pickupNote: "Collect from Flamio, Kishoreganj Sadar, Gurudayal College.",
  defaultZoneId: "kishoreganj_sadar",
};
