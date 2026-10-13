# Phase 1 — Exact Scope (read-only verification, nothing changed yet)

## 1. Exact Phase 1 scope

UI
- `/owner/customers` keeps its current list, stats, segments, promo broadcast and one-customer notification exactly as they are. Added: a search box (name/phone), a sort control, and each card becomes clickable.
- New customer profile page at `/owner/customers/$customerId`: header (name, masked or unmasked phone, customer type, first/last order), stats (orders, total spend, average order value), read-only order history, and — for accounts only — read-only reviews, rewards, vouchers, addresses, favourites, existing conversation link. Plus internal notes and tags (staff-only, new).
- Phone numbers stay masked; an "unmask" action is available only with full customer access and writes an audit row.

Database (new tables only, additive; no existing table altered in Phase 1)
- `crm_customers`, `crm_customer_identities`, `crm_customer_notes`, `crm_customer_tags`, `crm_customer_tag_links`, `crm_access_audit`.
- No column added to `orders` in Phase 1. Orders are matched to a CRM record at read time through the identity table (normalised phone / `user_id`), so no write to existing data and nothing to backfill or undo.

Backend / server functions
- New `src/lib/crm.functions.ts` + `src/lib/crm.server.ts`: build-or-refresh CRM records from existing orders and profiles, get profile detail, list with search/sort, notes CRUD, tags CRUD, record an unmask audit event. All owner/staff-only, permission-checked server-side.
- Existing `ownerListCustomers` (reports.functions.ts) and the notify functions (push.functions.ts) are called, not modified.

RLS / policies
- Only on the six new tables: RLS enabled, nothing granted to anon, read/write for owner/admin and permitted staff via server functions using the service role. No existing policy touched.

Authentication: no change. Notifications: no change (Phase 1 sends nothing new).

Existing files modified
- `src/routes/_authenticated/owner.customers.tsx` — search, sort, clickable cards.
- `src/routes/_authenticated/owner.tsx` — register the new child route in the permission map.
- `src/lib/permissions.ts` — add keys `customer_profiles`, `customer_notes`, `communication_logs` (logs listed now so the catalogue is stable; unused until Phase 2).

New files
- `src/routes/_authenticated/owner.customers.$customerId.tsx`
- `src/lib/crm.functions.ts`, `src/lib/crm.server.ts`
- `src/components/owner/CustomerProfile.tsx`, `CustomerNotes.tsx`, `CustomerTags.tsx`
- `docs/sql/customer_crm_phase1.sql` (for you to review and run manually)

Existing tables reused read-only: `orders`, `profiles`, `reviews`, rewards/vouchers/coupons, `addresses`, favourites, conversations, `order_messages`, `notifications`, `staff_permissions`, `user_roles`.

## 2. Existing functionality protection

Phase 1 will NOT change: guest checkout, registered ordering, the existing customer list logic/stats, existing segmentation (New/Returning/Frequent/Inactive), Web Push, notifications, customer-initiated chat, order messages, Owner/Staff permission engine (only new keys added), authentication, rewards, reviews, orders, POS/kitchen/inventory/delivery, Owner dashboard, Staff dashboard, customer app and its navigation.

## 3. Customer identity in Phase 1

- Registered customer: CRM record with an `auth_user` identity plus their profile phone (flagged verified when Auth verified it).
- Guest customer: CRM record with a `phone` identity marked unverified, derived from orders.
- Orders are associated by identity match at read time; order rows are not written.
- Guest-to-account linking: NOT in Phase 1. No automatic merge, no merge UI. Where a phone matches an account, the profile shows an informational "possible same person" note only — no data is joined or changed. Merging arrives in Phase 4 with owner confirmation and audit.

## 4. Communication

Phase 1 is database + backend + UI for CRM only — infrastructure and screens, no messaging. Phase 1 sends nothing new: no Push, no SMS, no WhatsApp, no Email, no new in-app messages. The existing "Send a promotion" and "Message one customer" buttons keep working exactly as today, unchanged.

## 5. Database safety (no SQL run)

All six tables are new, created with `IF NOT EXISTS`, RLS on, nothing to anon, no existing data read-modified or deleted.
- `crm_customers` — one record per recognised person. Columns: id uuid PK, display_name, primary_phone (normalised), customer_type (guest|account), first_order_at, last_order_at, created_at, updated_at. Indexes: primary_phone, last_order_at desc. Read: owner/admin + staff with customer access. Write: server functions only.
- `crm_customer_identities` — id, crm_customer_id FK → crm_customers ON DELETE CASCADE, kind (auth_user|phone|email), value, verified_at, source, created_at. Unique (kind, value). Index (crm_customer_id).
- `crm_customer_notes` — id, crm_customer_id FK cascade, body, created_by FK → auth.users ON DELETE SET NULL, created_at, updated_at. Index (crm_customer_id, created_at desc).
- `crm_customer_tags` — id, name unique, colour, created_at. `crm_customer_tag_links` — crm_customer_id FK cascade, tag_id FK cascade, PK (crm_customer_id, tag_id).
- `crm_access_audit` — id, crm_customer_id, actor_id FK → auth.users, action (view_profile|unmask_phone), created_at. Append-only; index (crm_customer_id, created_at desc).

## 6. File impact

Modify: `owner.customers.tsx` (search/sort/links), `owner.tsx` (route permission map), `src/lib/permissions.ts` (three new keys).
Create: `owner.customers.$customerId.tsx`, `src/lib/crm.functions.ts`, `src/lib/crm.server.ts`, `src/components/owner/CustomerProfile.tsx`, `CustomerNotes.tsx`, `CustomerTags.tsx`, `docs/sql/customer_crm_phase1.sql`.

## 7. Phase 1 test checklist

- Registered customer: places an order, sees own orders/rewards/reviews/notifications unchanged; profile page shows the same totals as the list.
- Guest customer: guest checkout completes; the guest appears in the list and opens a profile with orders and no account-only sections.
- Owner: list search/sort work; profile opens; notes and tags save and persist; unmask writes an audit row.
- Staff: No access → customers hidden and the profile URL blocked; View only → profile readable, notes/tags read-only; Full → notes/tags editable. Verified server-side, not just hidden.
- Existing notifications: promo broadcast and single-customer notification still deliver in-app + push as before.
- Existing chat: customer sends a message, owner inbox receives and replies.
- Existing orders: place, accept, prepare, deliver unaffected; POS sale unaffected.
- Mobile/PWA: list and profile usable at 390px; staff bottom nav unchanged; service worker/push toggle unaffected.
- RLS/security: signed-out and customer sessions get no access to the new tables; one staff member cannot read another customer's data beyond their permission.
- Regression: typecheck + build clean; Home, Orders, Messages, Account tabs render for owner and staff.

## 8. Risks and mitigations

- Data loss: none possible — Phase 1 only creates tables and never writes to existing ones.
- Duplicate CRM customers (same person under two phone formats): mitigated by storing only normalised phones with a unique identity constraint, and by the refresh being idempotent (upsert on identity, never insert-blind).
- Broken notifications: notification code is not touched; the existing buttons keep their current path.
- Broken orders / authentication: no order or auth code paths are modified.
- RLS problems: policies added only on new tables; existing policies untouched; verified with signed-out and customer sessions.
- Duplicate messages: Phase 1 sends nothing.
- Permission escalation: new keys default to No access for every existing staff row; owner/admin only for audit and identity data; every new server function calls the existing permission assertion before reading.

## 9. Final confirmation

PHASE 1 WILL CHANGE: customers list (search, sort, clickable cards); new customer profile page; internal notes and tags; CRM identity records built from existing data; three new permission keys; phone unmask audit.

PHASE 1 WILL NOT CHANGE: guest checkout, ordering, existing list stats and segmentation, Web Push, notifications, customer-initiated chat, order messages, permission engine behaviour, authentication, rewards, reviews, orders, POS, kitchen, inventory, delivery, customer app, Owner/Staff dashboards and navigation.

NEW DATABASE OBJECTS: crm_customers, crm_customer_identities, crm_customer_notes, crm_customer_tags, crm_customer_tag_links, crm_access_audit — plus their indexes, grants and RLS policies. No changes to existing tables.

EXTERNAL SERVICES REQUIRED: none.

EXTERNAL SERVICES NOT REQUIRED: SMS, WhatsApp, email, any push provider beyond what already exists.

FILES TO MODIFY: src/routes/_authenticated/owner.customers.tsx, src/routes/_authenticated/owner.tsx, src/lib/permissions.ts.

FILES TO CREATE: src/routes/_authenticated/owner.customers.$customerId.tsx, src/lib/crm.functions.ts, src/lib/crm.server.ts, src/components/owner/CustomerProfile.tsx, src/components/owner/CustomerNotes.tsx, src/components/owner/CustomerTags.tsx, docs/sql/customer_crm_phase1.sql.

REGRESSION RISKS: customers list UI (search/sort edits), owner route map (new child route), permissions catalogue (three additive keys). All narrow and verified by the checklist above.

ROLLBACK STRATEGY: revert the three modified files and delete the new ones — the app returns to today's behaviour instantly, because no existing table, policy or data is changed. The new tables can be left in place harmlessly (they are unreferenced) or dropped by you later; nothing depends on them.
