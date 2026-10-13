import type { DeliveryZone } from "@/types/menu";

/**
 * Pure distance helpers shared by the browser (preview of the delivery fee)
 * and the server (authoritative recalculation when the order is placed).
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export function isValidLatLng(value: Partial<LatLng> | null | undefined): value is LatLng {
  return (
    !!value &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  );
}

/** Zones measured as a distance ring around the restaurant. */
export function radiusZones(zones: DeliveryZone[]): DeliveryZone[] {
  return zones.filter(
    (z) => z.zoneType === "radius" && z.radiusMaxM !== null && z.isActive,
  );
}

/**
 * Smallest ring that contains the distance. Sorting by the outer edge means a
 * customer sitting in two overlapping rings always gets the nearer (cheaper
 * to serve) one, so overlaps can never produce an ambiguous price.
 */
export function pickRadiusZone(zones: DeliveryZone[], distanceM: number): DeliveryZone | null {
  return (
    radiusZones(zones)
      .slice()
      .sort((a, b) => (a.radiusMaxM ?? 0) - (b.radiusMaxM ?? 0))
      .find((z) => distanceM >= (z.radiusMinM ?? 0) && distanceM <= (z.radiusMaxM ?? 0)) ?? null
  );
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} km`;
}
