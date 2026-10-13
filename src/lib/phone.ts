/**
 * Phone helpers. Phone is the primary customer identifier; email is optional.
 * Supabase password auth requires an email, so we derive a deterministic
 * address from the normalized phone number and keep any real email in the
 * customer profile.
 */

/** Normalizes any Bangladeshi input to a bare international number (8801XXXXXXXXX). */
export function normalizePhone(raw: string): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return `880${digits}`;
}

export function isValidPhone(raw: string): boolean {
  const digits = normalizePhone(raw);
  return digits.length >= 12 && digits.length <= 15;
}

export function formatPhone(raw: string): string {
  return `+${normalizePhone(raw)}`;
}

/** Deterministic auth email so one phone number maps to exactly one account. */
export function phoneToAuthEmail(raw: string): string {
  return `p${normalizePhone(raw)}@phone.flamio.app`;
}

/**
 * Canonical Bangladesh phone identity, or null when the value cannot be
 * trusted as a phone number. Used for CRM identity matching only — historical
 * order data is never rewritten.
 */
export function canonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = normalizePhone(raw);
  if (!/^8801[3-9]\d{8}$/.test(digits)) return null;
  return digits;
}
