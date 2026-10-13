# Flamio — migration plan: Lovable Cloud → own Supabase project

Status: **plan only**. Nothing in this document has been executed. Lovable Cloud is still
connected and no data, schema, bucket, or setting has been changed.

Current backend: Lovable-managed Supabase project `zhfrwnkwumziizwpguxv`
(URL `https://c--6ce3ea60-82c0-492a-a48e-806e3d6865ac-prod.lovable.cloud`).

---

## 1. Migration/schema files in the repo

`supabase/migrations/` — 23 files, chronological:

| File | Covers |
| --- | --- |
| 20260912203949 | categories, products, product_variants, product_images + seed |
| 20260912211851 | restaurant_settings + seed |
| 20260912213442 | settings: opens_at/closes_at, facebook_url, instagram_url, google_maps_url |
| 20260912213729 | delivery_zones |
| 20260912215250 | coupons |
| 20260912220137 | promo_banners |
| 20260912220702 | payment_providers + seed |
| 20260912223454 | banner image paths + banner-images storage policies |
| 20260912224625 | favorites |
| 20260912230550 | zone_type, radius_min_m/max_m, lat/lng, distance_m |
| 20260913210024 | profiles, avatar_path, profile-photos storage policies |
| 20260913210047 | grant |
| 20260914214536 | app_role enum, user_roles, has_role, claim_owner, inventory, purchases, suppliers, riders, orders/order_items, staff_permissions, apply_stock_change, consume_inventory_for_order, RLS + grants + updated_at triggers |
| 20260914214701 | rewards (rules/transactions/claims), notifications, push_tokens, award_completed_order_reward |
| 20260914214805 | reward rule + inventory seeds |
| 20260915033358 | consolidated baseline re-statement (idempotent) |
| 20260915045237 | grant |
| 20260916191920 | challenges engine (challenges, sessions, play_state, play_grants, winners, settings) |
| 20260916202208 | settings: recommendations_enabled, recommendations_count |
| 20260916202922 | combos, combo_groups, order_items.combo_name/combo_key |
| 20260916204550 | order_reviews + reviews_enabled, review_photos_enabled |
| 20260916204631 | review-photos storage policies |
| 20260917015243 | settings: facebook_page_name |

`drizzle/migrations/0000_grant_customer_addresses_access.sql` — grant on customer_addresses.
`drizzle/schema.ts` + `drizzle.config.ts` exist but are effectively unused (config reads
`LOVABLE_DB_MIGRATION_URL`); the real source of truth is `supabase/migrations/`.

### Coverage check against the live database

Verified object-by-object against the running database:

- **Tables:** all 38 `CREATE TABLE public.*` statements match the live set — no live table is missing from the files.
- **Functions:** all 7 (`has_role`, `claim_owner`, `apply_stock_change`, `consume_inventory_for_order`, `award_completed_order_reward`, `request_order_review`, `update_updated_at_column`) are in the files.
- **Triggers:** all 32 live triggers are in the files.
- **Enum:** `app_role` (owner/admin/staff) is in the files.
- **RLS policies:** all live `public` policies and all **11** `storage.objects` policies are in the files. The 11 storage rules, verified live:
  - `profile-photos` (4): Customers can **view / upload / update / delete their profile photo** — all scoped to `bucket_id = 'profile-photos'` and first path folder = `auth.uid()`.
  - `review-photos` (5): Customers can **view / upload / delete their review photo** (own folder), plus **Restaurant team can view review photos** — SELECT for `has_role(auth.uid(), 'owner' | 'admin' | 'staff')`.
  - `banner-images` (3): Owners can **upload / update / delete banner images** — `has_role(auth.uid(), 'owner' | 'admin')`. **There is no SELECT policy on `banner-images`** — see the banner read-access note in section 2.
- **Grants:** present in every table-creating migration.
- **Indexes:** all live indexes are either PK/unique constraints declared inline or explicit `CREATE INDEX` in the files.
- **Columns:** every column added later (facebook fields, recommendations, reviews toggles, combo labels, geo/radius fields, photo paths) traces to a migration file.

### Not covered by migration files — must be handled manually

1. **Storage buckets themselves.** The 4 buckets were created through the platform tool, not SQL. Only their *policies* are in the files. Buckets must be created by hand on the new project.
2. **Auth configuration.** Email sign-up enabled + email auto-confirmation on. Not in SQL.
3. **Seed/production data beyond the seeds in the files.** The 24 products, categories, delivery zone, payment methods and reward rules do come from migration seeds, but any row edited later in the app (settings, orders, customers, winners, favorites, addresses) exists only in the live database and needs a data dump.

### Live data snapshot (verified, latest counts — restore all of these)

| Data | Live rows |
| --- | --- |
| Orders | **6** |
| Order lines | **8** |
| Reviews | **1** |
| Review photos (storage objects) | **1** |
| Challenge winners | **1** |
| Game sessions | **3** |
| Reward entries | **3** |
| Menu items | **24** |
| Categories | **5** |
| Challenges (games) | **10** |
| Auth accounts | 4 (1 owner, 1 unconfirmed — see step 9) |
4. **Auth users.** 4 accounts including the owner live in `auth.users`; not reproducible from migrations.
5. **Secrets/env values.** Listed in section 5.

### Direct out-of-band changes detected

- Two column type corrections (`orders.zone_id`, `customer_addresses.zone_id` uuid → text) were applied and *are* recorded as migrations — no drift.
- Bucket creation and auth settings were applied outside SQL (see above) — the only real drift.
- Test/verification data created during earlier testing was removed; one leftover test account
  (`p8801647502172@phone.flamio.app`, the current owner) and two test orders remain by your instruction.

---

## 2. Storage buckets and the fields that reference them

All 4 buckets are **private**; files are served via signed URLs.

| Bucket | Referencing fields | Path convention | Used in code |
| --- | --- | --- | --- |
| `profile-photos` | `profiles.avatar_path` | `<auth-user-id>/<file>` | yes |
| `review-photos` | `order_reviews.photo_path` | `<auth-user-id>/<file>` | yes |
| `banner-images` | `promo_banners.desktop_image_path`, `promo_banners.mobile_image_path`, `challenges.banner_path` | owner-uploaded paths | yes |
| `product-images` | `products` imagery is stored as `product_images.url` (path string) | — | **no code path currently uploads to or reads this bucket** — safe to recreate empty |

Rule for migration: object paths are stored in the database, so **objects must keep identical
key names** in the new project, and `profiles.avatar_path` / `order_reviews.photo_path` prefixes
must match the *new* auth user IDs. Preserving original user IDs (section 3) avoids rewriting paths.

**Banner read-access behaviour (verified):** `banner-images` is **private** and has **no SELECT
policy** (only owner/admin INSERT/UPDATE/DELETE). Banner images on the public homepage are served
through **server-side signed URLs created by the service-role client**, which bypasses RLS.
Exact rule required after migration: **none beyond the existing 3 write policies** — keep the
bucket private, keep `SUPABASE_SERVICE_ROLE_KEY` set correctly, and banners keep displaying.
Do **not** add an anon SELECT policy or make the bucket public unless you intentionally change
that design.

**Stored photo ownership (verified):** the single stored photo (`review-photos`, 1 object) lives
under the current **owner account's folder** (`e17aaaaa-…`). If that auth user is not migrated
**with the same UUID**, the path prefix no longer matches `auth.uid()` and the photo becomes
orphaned (unreadable/undeletable by its owner). Preserve original auth UUIDs — see section 3.

---

## 3. Auth-dependent tables (`auth.users` IDs)

Direct FK to `auth.users(id)`:
`profiles.id`, `customer_addresses.user_id`, `favorites.user_id`, `orders.user_id` (nullable — guest orders),
`notifications.user_id`, `push_tokens.user_id`, `user_roles.user_id`, `staff_permissions.user_id`,
`reward_transactions.user_id`, `reward_claims.user_id` + `reviewed_by`, `order_reviews.user_id`,
`inventory_movements.created_by`, `purchases.created_by`,
`challenge_sessions.user_id`, `challenge_play_state.user_id`, `challenge_play_grants.user_id`,
`challenge_winners.user_id`.

Plus storage paths keyed by user ID (section 2) and every RLS policy using `auth.uid()`.

**Critical:** migrate `auth.users` **preserving the original UUIDs**, before restoring public data,
or every FK insert fails and owner/staff access is lost. Password hashes can be carried over with a
full `auth` schema dump; if only a data-level export is possible, users must reset passwords.

---

## 4. RPCs called from the app

`has_role`, `claim_owner`, `apply_stock_change`, `consume_inventory_for_order` (called via `.rpc`),
plus the trigger functions `award_completed_order_reward`, `request_order_review`, `update_updated_at_column`.
All are `SECURITY DEFINER` with `search_path = public` and must exist before data restore
(the order/reward/review triggers fire on inserts).

---

## 5. Environment variables & configuration

Read by the app:

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | anon/publishable key |
| `VITE_SUPABASE_PROJECT_ID` | browser | informational |
| `SUPABASE_URL` | server | API URL (SSR + server functions) |
| `SUPABASE_PUBLISHABLE_KEY` | server | user-scoped server client |
| `SUPABASE_SERVICE_ROLE_KEY` | server | admin client (`client.server.ts`) — bypasses RLS |
| `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS` | server | cron endpoint auth (Lovable-specific; replace with your own secret) |
| `LOVABLE_DB_MIGRATION_URL` | tooling | drizzle config only |

`supabase/config.toml` contains only `project_id`.

---

## 6. Lovable Cloud-specific code

| Item | Impact on external Supabase | Action |
| --- | --- | --- |
| `src/integrations/supabase/client.ts` (auto-generated) | uses `brokeredPreviewStorage()` for preview auth brokering | must be replaced with a plain `createClient` using standard localStorage auth storage |
| `src/integrations/supabase/previewAuthStorage.ts` | Lovable preview-only session brokering | delete/replace |
| `src/integrations/supabase/client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts` | generic, but auto-generated and regenerated by Lovable | keep, stop treating as generated |
| `src/integrations/supabase/types.ts` | generated types | regenerate with Supabase CLI against your project |
| `src/integrations/supabase/cron-auth.ts` | uses `LOVABLE_CRON_SECRET` | swap for your own secret |
| `src/lib/lovable-error-reporting.ts`, error hooks in `__root.tsx` | Lovable preview error reporting only | harmless, can be removed |
| Publishable-key handling (`sb_publishable_` → strips `Authorization`, sets `apikey`) | works with both new-format and legacy anon keys | keep |
| Hosting | app is served by Lovable; server functions run on Cloudflare Workers | if you also leave Lovable hosting, you need your own deploy target |

Nothing else is Lovable-locked: no edge functions, no Lovable AI calls in runtime paths, no proprietary extensions.

---

## 7. Migration checklist — exact order

**A. Prepare (no changes to current project)**
1. Create the new Supabase project; note URL, anon/publishable key, service role key, DB password.
2. Confirm required extensions exist (`pgcrypto`/`gen_random_uuid`) — default on Supabase.
3. Take a full backup of the current project: `pg_dump` schema+data for `public`, plus `auth` and `storage` schemas.
4. Download all objects from the 4 buckets, preserving exact key paths.
5. Record current auth settings (email sign-up on, auto-confirm on) and the current owner user ID.

**B. Schema on the new project**
6. Apply `supabase/migrations/*.sql` in filename order (they are the authoritative schema).
   **Seed-data collision handling (required):** several migrations contain seed `INSERT`s
   (products, restaurant_settings, payment_providers, reward rules, inventory). Two safe options
   — pick one before starting:
   - **Option 1 (recommended):** restore production data *first* (section D), then apply migrations
     wrapped so seed inserts no-op — run seeds inside `ON CONFLICT DO NOTHING` (or comment out the
     seed blocks before applying) so restored rows are never duplicated or overwritten.
   - **Option 2:** apply migrations *with* seeds on the empty project, then restore production data
     with `TRUNCATE ... CASCADE` on only the seeded tables immediately before inserting the dump —
     never truncate orders/users/reviews tables.
   Never apply seed inserts on top of already-restored production rows without a conflict guard:
   that is the one step that could duplicate menu items or overwrite edited settings.
7. Apply `drizzle/migrations/0000_grant_customer_addresses_access.sql`.
8. Verify: 38 tables, 7 functions, 32 triggers, `app_role` enum, all policies and grants present
   (including all **11** storage policies listed in section 1).

**C. Auth users**
9. Restore `auth.users` (and `auth.identities`) from the dump **with original UUIDs**; otherwise create users and plan a password reset.
   **Unconfirmed account (decision required before migration):** 1 of the 4 live accounts is
   **unconfirmed** (`email_confirmed_at` IS NULL). Decide before migrating: either (a) confirm it
   during restore by setting `email_confirmed_at` in the dump, or (b) leave it unconfirmed and let
   the user confirm on the new project. The owner account (`p8801647502172@phone.flamio.app`,
   UUID `e17aaaaa-9ac3-4005-bcdf-4424b01c6364`) **must** be carried over with the same UUID —
   it owns the only stored photo and holds the owner role.
10. Enable email sign-up and email auto-confirmation to match current behaviour.
11. Confirm `user_roles` will map the owner UUID (restored in step D).

**D. Data**
12. Restore `public` table data in FK order: categories → products → product_variants/product_images → inventory_items → product_ingredients → suppliers/riders → delivery_zones → payment_providers → restaurant_settings → promo_banners → coupons → combos → combo_groups → reward_rules → challenges/challenge_settings → profiles → customer_addresses → favorites → user_roles → staff_permissions → orders → order_items → inventory_movements → purchases → notifications → push_tokens → reward_transactions → reward_claims → order_reviews → challenge_sessions/play_state/play_grants/winners.
13. Disable triggers during restore (`SET session_replication_role = replica`) so `award_completed_order_reward` and `request_order_review` don't duplicate rewards/notifications, then re-enable.
14. Reset sequences if any are used (all keys are UUID defaults — expected: none).

**E. Storage**
15. Create the 4 buckets, all **private**; set `review-photos` file-size limit to 5 MB
    (currently 5,242,880 bytes). No MIME allow-lists are set today — keep it that way.
16. Upload the downloaded objects with identical keys (the review photo under the owner's UUID folder).
17. Confirm all **11** storage policies from the migrations exist (listed in section 1) — and that
    `banner-images` intentionally has **no** SELECT policy (server-side signed URLs, section 2).

**F. App configuration**
18. Point env vars at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and set your own cron secret.
19. Replace `client.ts` preview-auth storage with standard auth storage; remove `previewAuthStorage.ts`.
20. Regenerate `src/integrations/supabase/types.ts` from the new project.
21. Typecheck + production build.

**G. Verification (before going live)**
22. Sign up a new account; sign in the owner account and confirm the Owner Dashboard link and access.
23. Verify menu, categories, prices, variants, images render; banners and recommendations show.
24. Place one delivery and one pickup order; check order code, totals, kitchen list, inventory deduction, reward award, review-request notification.
25. Check combos add-to-cart and server-side re-pricing; challenges play/unlock; coupons; delivery zones/radius pricing.
26. Check profile photo and review photo upload + signed URL display.
27. Confirm staff permission gating with a test staff account, then remove it.
28. Run the security linter and compare against the 6 known pre-existing findings.

**H. Cutover & rollback**
29. Freeze order-taking briefly, re-dump the deltas (orders/notifications/reviews created since step 3), re-restore.
30. Switch DNS/env, monitor.
31. **Rollback:** revert env vars to the Lovable Cloud values and restore the original `client.ts`. The Lovable Cloud project is left completely untouched by this procedure, so rollback is a config-only revert — this is what makes the plan reversible.

---

## 8. Answers to the direct questions

- **Would data remain intact?** Yes, if steps C→E are followed with original UUIDs and identical storage keys. The risk is not data loss but broken links (photos, ownership) from changed IDs.
- **What could stop working?** Preview auth brokering (Lovable-only), the Lovable cron secret, the Lovable error reporting hook, and generated-file regeneration. Everything else is standard Supabase.
- **Can it be switched without rebuilding the app?** Yes — the only code changes needed are the auth-storage swap in `client.ts`, removing `previewAuthStorage.ts`, regenerating types, and the cron secret.
