# Data & Storage Management (Owner only)

## What I found in your project (inspection done, nothing changed yet)

**Already exists and will be reused**
- Owner Settings page with stacked sections (Payments, SMS, Integrations) — the new area plugs in here.
- Owner/staff role and permission system (roles table + staff permissions, server-side checks). Owner-only checks already available.
- A working scheduler: the database calls a protected app endpoint every minute with a secret (used today for notification jobs). The cleanup schedule reuses exactly this mechanism — no new external service.
- File storage buckets: banner images, product/menu images, profile photos, review photos, plus one old export folder (`database_export_17_09_26`) which will be treated as protected/unknown.
- Existing data that can sensibly be cleaned: old customer notifications, push delivery records, finished/failed background job records, and (only if you explicitly turn it on) old finished/cancelled orders.

**Important findings that shape the design**
- No table in your database has an "archived/deleted" flag, so there is nothing to reuse for soft delete. I will not add such flags to existing tables. Deletion of eligible records is therefore permanent, and the screen will say so plainly instead of pretending data is only archived.
- Deleting an order automatically removes its items, its order messages and its notifications (existing database rules). Orders that have stock movement records cannot be deleted at all — they will be shown as protected, not silently skipped.
- Current volumes are small (30 orders, 43 notifications), so no numbers will be invented; real counts only.
- Supabase quota/storage totals are not exposed to the app. The dashboard will show real measurable figures (record counts, file counts, file byte sizes from storage metadata) and "Usage information unavailable" for anything it cannot measure.

**What is missing and will be added**
Everything cleanup-related: settings storage, run history, preview engine, manual and bulk cleanup, orphan-file detection, scheduled run, owner UI.

## What I will build

**1. Database (additive only, in `docs/sql/data_cleanup.sql` — you review and run it; I will not run it)**
- `cleanup_settings` (one row per category: enabled, retention days, schedule, require approval, last/next run, unlock flag for high-risk categories)
- `cleanup_runs` (run type manual/auto/preview, status, category, requested/deleted/skipped/protected/failed counts, files deleted, bytes released, who started it, error summary, timestamps)
- `cleanup_run_items` (per-record outcome for the audit trail)
- `cleanup_state` (global pause switch, first-run approval, large-deletion pause flag)
All with row security on, owner/admin read only, writes only from the server. No existing table, column, policy or bucket is changed.

**2. Server logic (new files, existing patterns)**
- A category registry describing every cleanable category: which table, which date column, which rows are eligible, which are protected, and which files it may touch.
- Protected layer enforced server-side: owner/staff/customer accounts, any non-final order, payments, finance, salary/advance/loan records, inventory and purchase history, suppliers, menu and product images, active offers/coupons/banners, delivery and system configuration, security records, cleanup audit log itself.
- Preview (dry run) that deletes nothing and returns eligible / protected / affected-file counts.
- Manual delete: one record, selected records, or all eligible — with the same server-side eligibility rules re-checked on every call.
- Storage cleanup: lists real files per bucket with size and creation date, resolves each file against actual database references (banner paths, review photo paths, profile avatar paths, product image URLs). Anything unreferenced is "Orphaned"; anything it cannot resolve confidently is "Unknown / Protected" and never auto-deleted.
- Partial-failure reporting: per-record results, so a run reports Requested / Deleted / Skipped / Protected / Failed honestly.
- Scheduled runner behind the existing cron-secret endpoint: loads settings, honours the global pause, first-run approval and large-deletion pause, then runs each due category and writes the audit row.

**3. Owner UI (existing design system, mobile-first)**
- Settings gets a "Data & Storage Management" card linking to a new owner-only page (kept as its own page because of the amount of content; no new navigation for staff or customers).
- Overview cards: database records, storage usage, cleanup candidates, next auto cleanup, last cleanup + result, auto cleanup status.
- Manual Cleanup: category, date range/preset (7/15/30/45/60/90/180/365/custom), search and filters (eligible / protected / orphaned / selected), record list as mobile cards, per-record delete, select-all-eligible, bulk delete.
- Confirmation: plain-language warning with counts; high-risk categories require typing DELETE, plus a backup reminder note (no fake backup feature).
- Storage Cleanup: bucket, file, size, created, referenced by, status, single and multi delete.
- Automatic Cleanup: off by default, per-category retention and frequency (daily / 7 / 15 / 30 days), require-approval-before-first-run on by default, documented large-deletion pause threshold, Pause all, Disable, Stop next run.
- Cleanup History: list with date, type, category, records, files, status, who; opening a run shows details and errors.

**4. Defaults (off unless stated)**
- Orders cleanup: OFF, with the record-keeping warning and explicit unlock.
- Inventory / purchases / finance / staff money / customer accounts / reviews: not offered for automatic deletion at all; reviews only if you explicitly configure review retention.
- Old notifications, push delivery records, finished background jobs: available, automatic still OFF until you enable it.
- Orphaned storage: manual only by default, orphan verification required.

## Access
Owner only, enforced on the server. No new staff permission key is created, so no manager or staff member can gain access, and the page is not reachable from staff or customer navigation.

## Limits I will not paper over
- Automatic cleanup only becomes truly active after the SQL is run and the schedule entry is added; until then the screen says it is inactive.
- Storage savings are reported from real file sizes only; database space freed is not measurable and will be shown as unavailable.
- No backup/export system exists, so high-risk deletions show a reminder rather than an automatic backup.

I will not run the SQL, and no existing data will be deleted while building or testing.
