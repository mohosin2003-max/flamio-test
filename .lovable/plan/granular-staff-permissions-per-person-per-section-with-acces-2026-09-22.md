# Granular staff permissions (per-person, per-section, with access levels)

## What already exists (reused, not rebuilt)

- Each staff member already has **individual** section access stored per person (`staff_permissions`), not a fixed role. Owner and Manager are unrestricted.
- The Owner → Staff screen already has per-person tick boxes for 17 sections.
- Every server action already re-checks access before doing anything, so hiding a button is not the only protection.

What's missing, and what this plan adds:

1. Access is only **on/off** today — there is no "view only".
2. A few sections share one switch (Challenges/Rewards sit under Coupons, Reviews under Customers, Delivery under Settings, Riders under Orders, Banners/Combos under Menu), so they can't be granted separately.
3. Read actions and write actions are treated the same on the server.

## What will change

### 1. Access levels
Each section gets one of three levels per staff member:

- **No access** — hidden from their dashboard, and blocked if they type the address directly.
- **View only** — can open the section and see the information, but every add / edit / delete / adjust action is refused by the server and hidden in the screen.
- **Full access** — works exactly as it does today.

Existing staff keep **Full access** on everything they have switched on today, so nothing changes for them until the Owner edits it.

### 2. Sections that can be granted separately
Splitting the shared switches so these become individually controllable: Challenges, Rewards, Reviews, Delivery, Riders, Banners, Combos — alongside the existing Counter Sale, Online Orders, Order Management, Kitchen, Menu, Inventory, Purchases, Suppliers, Coupons, Customers, Reports, Staff, Staff Accounts, Own Salary, Own Money-Taken, Settings, Online Platform Sale. No section is duplicated.

For anyone already set up, the old grouped switch automatically carries over to its new sections (e.g. someone with Coupons keeps Challenges and Rewards) until the Owner changes it.

### 3. Owner control screen
Owner → Staff → each staff card gets a clean permission list: one row per section with a **No access / View only / Full access** picker, grouped by area (Selling, Kitchen & stock, Marketing, People, Reports & settings). Plus four safe bulk buttons — Full access to all, View only on all, No access, Reset — each requiring one confirm so nothing changes by accident.

### 4. Enforcement
- Navigation only shows permitted sections; typing an address for a section they don't have shows "Access restricted".
- Write actions are refused on the server for view-only staff, whatever the browser sends — direct address, refresh, replayed request or a hidden button all fail the same way.
- Owner keeps unrestricted access everywhere.

## Technical notes

- `staff_permissions` gains one column: `access_level text not null default 'manage'` (`'view'` | `'manage'`). Additive only — existing rows default to today's behaviour. No other table, RLS policy or auth change.
- `src/lib/permissions.ts`: new section keys, `ACCESS_LEVELS`, legacy-key inheritance map, `hasPermission()` (unchanged meaning: can open) plus `canManage()`.
- `src/lib/owner.server.ts`: `getAccessProfile` returns per-section levels; `assertPermission(userId, key, level)` defaults to `"manage"` so an unmarked action fails closed. Read-only endpoints are explicitly marked `"view"`.
- Every `*.functions.ts` endpoint is audited: GET/list handlers → `"view"`, create/update/delete/adjust handlers → `"manage"`.
- `src/routes/_authenticated/owner.tsx`: tab list updated to the new keys, route gate unchanged in shape.
- `src/routes/_authenticated/owner.staff.tsx`: tick boxes replaced with the level pickers + bulk buttons.
- Module screens receive the level through the existing `["owner-access"]` query and hide write controls when view-only. No redesign of Counter Sale, Orders, Kitchen, Inventory, Coupons, Challenges, Rewards, Staff Accounts or payroll.
- SQL is delivered in `docs/sql/staff_permission_levels.sql` for you to run once in External Supabase; the app keeps working before it is run (everything behaves as Full access, as today).

## Verification

Typecheck, production build, plus checks that unauthorised addresses are blocked, view-only write actions are refused server-side, and existing staff and Owner access are unchanged.
