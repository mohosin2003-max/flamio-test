import type { CustomerLocation } from "@/types/menu";

const STORAGE_KEY = "flamio.location.v1";

export function loadCustomerLocation(): CustomerLocation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomerLocation;
    return typeof parsed?.label === "string" && parsed.label ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCustomerLocation(location: CustomerLocation | null): void {
  try {
    if (location) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable – selection still works for this session */
  }
}

/** Reverse-geocode GPS coordinates to a readable address (OpenStreetMap Nominatim). */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return typeof data.display_name === "string" && data.display_name
    ? data.display_name
    : null;
}
