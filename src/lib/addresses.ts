import type { CustomerAddress } from "@/types/menu";

/**
 * Saved-address store. Local for now; the same CRUD surface can be backed by
 * the database later without changing checkout.
 */
const STORAGE_KEY = "flamio.addresses.v1";

export function loadAddresses(): CustomerAddress[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CustomerAddress[]) : [];
  } catch {
    return [];
  }
}

export function saveAddresses(addresses: CustomerAddress[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
  } catch {
    /* storage unavailable – checkout still works for this session */
  }
}

export function clearDeviceAddresses(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function upsertAddress(
  addresses: CustomerAddress[],
  address: CustomerAddress,
): CustomerAddress[] {
  const exists = addresses.some((a) => a.id === address.id);
  const next = exists
    ? addresses.map((a) => (a.id === address.id ? address : a))
    : [...addresses, address];
  return address.isDefault ? next.map((a) => ({ ...a, isDefault: a.id === address.id })) : next;
}

export function deleteAddress(addresses: CustomerAddress[], id: string): CustomerAddress[] {
  return addresses.filter((a) => a.id !== id);
}

export function emptyAddress(): CustomerAddress {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `addr_${Date.now()}`,
    label: null,
    fullName: "",
    phone: "",
    addressLine: "",
    area: null,
    zoneId: null,
    landmark: null,
    deliveryNotes: null,
    isDefault: false,
    latitude: null,
    longitude: null,
  };
}
