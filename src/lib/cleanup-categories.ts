/**
 * Client-safe catalogue for the owner's Data & Storage Management area.
 *
 * Every entry maps to data that really exists in this project. Nothing here
 * grants access — the server re-checks owner rights and re-applies eligibility
 * for each request.
 */

export const CLEANUP_CATEGORIES = [
  "notifications",
  "push_deliveries",
  "notification_jobs",
  "expired_push_tokens",
  "communication_log",
  "completed_orders",
  "cancelled_orders",
  "old_reviews",
  "orphan_files",
] as const;

export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];

export type CleanupRisk = "low" | "medium" | "high";

export interface CleanupCategoryInfo {
  id: CleanupCategory;
  label: string;
  description: string;
  group: string;
  risk: CleanupRisk;
  /** High risk needs an explicit unlock and the word DELETE typed out. */
  highRisk: boolean;
  /** Can this category ever run on a schedule? */
  autoSupported: boolean;
  defaultRetentionDays: number;
  defaultFrequencyDays: number;
  /** Deletion is permanent — no table in this project has an archive flag. */
  permanent: boolean;
  warning?: string;
}

export const CLEANUP_CATEGORY_INFO: Record<CleanupCategory, CleanupCategoryInfo> = {
  notifications: {
    id: "notifications",
    label: "Old customer notifications",
    description: "In-app notification messages customers already received.",
    group: "Customer engagement",
    risk: "low",
    highRisk: false,
    autoSupported: true,
    defaultRetentionDays: 30,
    defaultFrequencyDays: 7,
    permanent: true,
  },
  push_deliveries: {
    id: "push_deliveries",
    label: "Phone delivery records",
    description: "Technical records of which device a notification reached.",
    group: "Customer engagement",
    risk: "low",
    highRisk: false,
    autoSupported: true,
    defaultRetentionDays: 30,
    defaultFrequencyDays: 7,
    permanent: true,
  },
  notification_jobs: {
    id: "notification_jobs",
    label: "Finished background jobs",
    description: "Completed or cancelled scheduled notification tasks.",
    group: "System housekeeping",
    risk: "low",
    highRisk: false,
    autoSupported: true,
    defaultRetentionDays: 15,
    defaultFrequencyDays: 7,
    permanent: true,
  },
  expired_push_tokens: {
    id: "expired_push_tokens",
    label: "Dead device subscriptions",
    description: "Only device subscriptions the system already marked inactive.",
    group: "System housekeeping",
    risk: "low",
    highRisk: false,
    autoSupported: true,
    defaultRetentionDays: 60,
    defaultFrequencyDays: 30,
    permanent: true,
  },
  communication_log: {
    id: "communication_log",
    label: "Message history log",
    description: "Old records of messages sent to customers.",
    group: "Customer engagement",
    risk: "medium",
    highRisk: false,
    autoSupported: true,
    defaultRetentionDays: 180,
    defaultFrequencyDays: 30,
    permanent: true,
    warning:
      "This is your proof of what was sent to a customer. Keep it long enough for customer service.",
  },
  completed_orders: {
    id: "completed_orders",
    label: "Finished orders",
    description: "Completed orders, including their items, messages and reviews.",
    group: "Orders",
    risk: "high",
    highRisk: true,
    autoSupported: true,
    defaultRetentionDays: 365,
    defaultFrequencyDays: 30,
    permanent: true,
    warning:
      "Order history may be useful for customer service, reporting, accounting and business records. Deleting finished orders also removes them from your sales reports. Choose a retention period carefully.",
  },
  cancelled_orders: {
    id: "cancelled_orders",
    label: "Cancelled orders",
    description: "Cancelled orders and their items.",
    group: "Orders",
    risk: "high",
    highRisk: true,
    autoSupported: true,
    defaultRetentionDays: 180,
    defaultFrequencyDays: 30,
    permanent: true,
    warning:
      "Cancelled orders can still matter for disputes and reporting. Choose a retention period carefully.",
  },
  old_reviews: {
    id: "old_reviews",
    label: "Old customer reviews",
    description: "Reviews you have already handled, with their photo.",
    group: "Reviews",
    risk: "high",
    highRisk: true,
    autoSupported: false,
    defaultRetentionDays: 365,
    defaultFrequencyDays: 30,
    permanent: true,
    warning:
      "Reviews are customer feedback. Nothing is removed unless you set a review retention period yourself.",
  },
  orphan_files: {
    id: "orphan_files",
    label: "Unused files",
    description: "Stored files no active record points at any more.",
    group: "Storage",
    risk: "medium",
    highRisk: false,
    autoSupported: false,
    defaultRetentionDays: 30,
    defaultFrequencyDays: 30,
    permanent: true,
    warning:
      "A file is only offered for deletion when the system can prove no record uses it. Anything it cannot verify stays protected.",
  },
};

export const RETENTION_PRESETS = [7, 15, 30, 45, 60, 90, 180, 365] as const;
export const FREQUENCY_PRESETS = [1, 7, 15, 30] as const;

/** Things this system will never delete, shown to the owner as-is. */
export const PROTECTED_DATA = [
  "Owner, staff and customer accounts",
  "Any order that is not finished or cancelled (placed, confirmed, preparing, ready, out for delivery)",
  "Orders that are tied to stock movements",
  "Payments, finance, profit, withdrawals and expense records",
  "Staff salary, advance, loan and money records",
  "Inventory, purchase and supplier history",
  "Menu, product and current product photos",
  "Active offers, coupons and banners",
  "Delivery zones and system configuration",
  "Login, role and security records",
  "Reviews awaiting your moderation",
  "The cleanup history itself",
];

export function categoryLabel(id: string): string {
  return CLEANUP_CATEGORY_INFO[id as CleanupCategory]?.label ?? id;
}
