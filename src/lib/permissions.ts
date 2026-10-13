/**
 * Shared (client-safe) permission catalogue for dashboard access.
 *
 * Owners and managers (admins) are unrestricted; these keys only narrow what a
 * `staff` member can see and do. They reuse the existing roles system — a
 * person still needs a row in `public.user_roles`.
 *
 * Each granted section carries an access level:
 *  - "view"   → can open the section, but every write action is refused.
 *  - "manage" → full access (the behaviour every existing grant already has).
 */

export const STAFF_PERMISSIONS = [
  "pos",
  "platform_sales",
  "online_orders",
  "order_management",
  "riders",
  "kitchen",
  "menu",
  "combos",
  "banners",
  "inventory",
  "purchases",
  "suppliers",
  "coupons",
  "rewards",
  "challenges",
  "customers",
  "customer_profiles",
  "customer_notes",
  "communication_logs",
  "customer_messaging",
  "reviews",
  "reports",
  "delivery",
  "staff",
  "staff_finance",
  "own_salary",
  "own_money_taken",
  "own_profit_share",
  "settings",
  "integrations",
  "account_recovery",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const ACCESS_LEVELS = ["view", "manage"] as const;
export type StaffAccessLevel = (typeof ACCESS_LEVELS)[number];

export type PermissionGrants = Partial<Record<StaffPermission, StaffAccessLevel>>;

export const ACCESS_LEVEL_LABELS: Record<StaffAccessLevel, string> = {
  view: "View only",
  manage: "Full access",
};

export const PERMISSION_LABELS: Record<StaffPermission, string> = {
  pos: "Counter Sale",
  platform_sales: "Online Platform Sale",
  online_orders: "Online Orders",
  order_management: "Order Management",
  riders: "Riders",
  kitchen: "Kitchen / KDS",
  menu: "Menu Management",
  combos: "Combos",
  banners: "Promo Banners",
  inventory: "Inventory",
  purchases: "Purchases",
  suppliers: "Suppliers",
  coupons: "Offers & Coupons",
  rewards: "Rewards",
  challenges: "Challenges",
  customers: "Customers / CRM",
  customer_profiles: "Customer Profiles",
  customer_notes: "Customer Notes & Tags",
  communication_logs: "Communication History",
  customer_messaging: "Message Customers",
  reviews: "Reviews",
  reports: "Reports",
  delivery: "Delivery zones",
  staff: "Staff Management",
  staff_finance: "Staff Accounts",
  own_salary: "Own Salary",
  own_money_taken: "Own Money-Taken",
  own_profit_share: "Own Profit Share",

  settings: "Settings",
  integrations: "Integrations & Providers",
  account_recovery: "Account Recovery",
};

export const PERMISSION_HINTS: Partial<Record<StaffPermission, string>> = {
  order_management: "Change order status and assign deliveries",
  settings: "Restaurant settings, payment and SMS setup",
  own_salary: "Lets this person see only their own salary and money records",
  own_money_taken: "Lets this person submit money-taken requests for owner approval",
  own_profit_share: "Lets a profit partner see only their own profit share",
  customer_profiles: "Open a customer's profile and reveal their phone number",
  customer_notes: "Add internal notes and tags on a customer",
  communication_logs: "See what was sent to a customer",
  customer_messaging: "Send a message to a customer (inbox, push, SMS, WhatsApp, email)",
  integrations: "Set up SMS, WhatsApp, email and payment providers",
  account_recovery: "Review password-recovery requests and issue one-time codes",
};


/**
 * Sections that used to sit under a wider switch. Someone who already has the
 * older section keeps the newer ones until the owner changes it.
 */
export const PERMISSION_FALLBACK: Partial<Record<StaffPermission, StaffPermission>> = {
  rewards: "coupons",
  challenges: "coupons",
  reviews: "customers",
  delivery: "settings",
  riders: "order_management",
  banners: "menu",
  combos: "menu",
  // Provider setup already lived under Settings, so that stays consistent.
  integrations: "settings",
  // Sending to customers is a new capability on purpose: it has NO fallback,
  // so nobody gains it implicitly from an older permission.
};

/** Grouping used by the owner's permission editor. */
export const PERMISSION_GROUPS: { title: string; permissions: StaffPermission[] }[] = [
  {
    title: "Selling",
    permissions: ["pos", "online_orders", "order_management", "riders", "platform_sales"],
  },
  {
    title: "Kitchen & stock",
    permissions: ["kitchen", "inventory", "purchases", "suppliers"],
  },
  {
    title: "Menu & marketing",
    permissions: ["menu", "combos", "banners", "coupons", "rewards", "challenges"],
  },
  {
    title: "Customers",
    permissions: [
      "customers",
      "customer_profiles",
      "customer_notes",
      "communication_logs",
      "customer_messaging",
      "reviews",
      "account_recovery",
    ],
  },
  {
    title: "People & money",
    permissions: ["staff", "staff_finance", "own_salary", "own_money_taken", "own_profit_share"],
  },
  {
    title: "Reports & setup",
    permissions: ["reports", "delivery", "settings", "integrations"],
  },
];

export function isStaffPermission(value: string): value is StaffPermission {
  return (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

export function isAccessLevel(value: string): value is StaffAccessLevel {
  return (ACCESS_LEVELS as readonly string[]).includes(value);
}

export type PermissionAccess = {
  isOwner?: boolean;
  isManager?: boolean;
  permissions?: string[];
  grants?: Record<string, string> | PermissionGrants | null;
} | null | undefined;

function readGrant(
  access: NonNullable<PermissionAccess>,
  permission: StaffPermission,
): StaffAccessLevel | null {
  const grants = (access.grants ?? null) as Record<string, string> | null;
  const direct = grants?.[permission];
  if (direct && isAccessLevel(direct)) return direct;
  // Compatibility: older callers only send a flat list of granted sections.
  if (!grants && (access.permissions ?? []).includes(permission)) return "manage";
  return null;
}

/** The person's level for this section, or null when they have no access. */
export function permissionLevel(
  access: PermissionAccess,
  permission: StaffPermission,
): StaffAccessLevel | null {
  if (!access) return null;
  if (access.isManager) return "manage";
  const direct = readGrant(access, permission);
  if (direct) return direct;
  const fallback = PERMISSION_FALLBACK[permission];
  if (fallback) return readGrant(access, fallback);
  return null;
}

/** Can this person open the section (view or manage)? Owners/managers always can. */
export function hasPermission(access: PermissionAccess, permission: StaffPermission): boolean {
  return permissionLevel(access, permission) !== null;
}

/** Can this person change things in the section? */
export function canManage(access: PermissionAccess, permission: StaffPermission): boolean {
  return permissionLevel(access, permission) === "manage";
}
