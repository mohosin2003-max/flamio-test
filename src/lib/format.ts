export function formatBDT(amount: number): string {
  return `৳${amount.toLocaleString("en-US")}`;
}

/** Display-only whole-Taka format for sales screens; stored values are unchanged. */
export function formatTaka(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-US")}`;
}
