# Granular staff permissions

Upgrade the existing Staff Management screen so the owner can switch individual sections on or off per staff member. Nothing else in the app changes.

## How it works today

- People get one role: Owner, Manager (admin) or Staff.
- Owner and Manager can open every dashboard section; Staff can only open the Kitchen screen.
- The dashboard hides nothing per person, and each server action re-checks the role.

## What changes

1. A permission list is stored per staff member, reusing the existing team/roles setup (no second accounts system).
2. In Owner → Staff, each team member gets a "Custom permissions" panel with one toggle per section:
   Counter Sale, Online Orders, Order Management, Kitchen / KDS, Menu, Inventory, Purchases, Suppliers, Offers & Coupons, Customers, Reports, Staff Management, Settings.
   (Delivery zones, Riders and Banners are folded into Settings, Order Management and Menu respectively so no section becomes unreachable.)
3. The dashboard menu only shows the sections a person is allowed to use, and the dashboard home opens their first allowed section.
4. Every server action behind those sections checks the same permission, so typing a URL or calling the action directly is refused.
5. Owner stays completely unrestricted. Manager keeps full access as today.
6. A staff member with only Counter Sale sees only Counter Sale; turning more toggles on makes those sections appear on their next load.

## Technical detail

- New table `public.staff_permissions` (user_id, permission text, timestamps, unique per pair), GRANT + RLS: users may read their own rows; all writes via service role only. No changes to `user_roles`, `profiles` or `owner_invites`.
- New server-only helper in `src/lib/owner.server.ts`: `getEffectivePermissions(userId)` and `assertPermission(userId, permission)`. Owner/admin short-circuit to "all". `assertOwner` keeps its current behaviour for owner-only endpoints; existing owner endpoints move to `assertPermission(..., <area>)` so managers and permitted staff are unaffected in behaviour.
- `getOwnerAccess` additionally returns `permissions: string[]`; `owner.tsx` filters `TABS` by it and `owner.index.tsx` / kitchen link respect it.
- `src/lib/staff.functions.ts` gains `permissions` on `StaffMember` plus `ownerSetStaffPermissions` (owner/admin only, reuses `assertOwner`).
- `assertKitchen` becomes a permission check for the `kitchen` permission, keeping owner/admin access.
- Verification: typecheck, production build, and a signed-in browser pass over the owner dashboard plus a restricted-staff simulation, cleaning up any test rows.
