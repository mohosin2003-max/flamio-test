# FLAMIO ATTENDANCE MASTER — TEST Migration Review

**Status: REVIEW ONLY — NOT EXECUTED.**  
**Target:** TEST project `avwrptztixaketchgmsh` only.  
**Production project `wubsldblxvkusauafwfd`: explicitly out of scope.**

## Decision

Do not execute `attendance_master_schema.sql` as-is. It is not yet an approved additive-only migration. A safer, versioned migration must be produced after the checks below. No SQL has been run and no database objects or data were changed during this review.

## High-priority findings in the existing draft

1. **Identity and authorization are mixed into an attendance migration.** Section 1 can create/alter `app_role`, `profiles`, and `user_roles`; adds profile columns; adds a unique role constraint; grants privileges on existing identity tables; creates RLS policies; and replaces `has_role()`, `claim_owner()`, and `update_updated_at_column()`. These are not attendance-only changes. Even if intended as compatible, they can affect login, role assignment, existing profile access, and first-owner onboarding. Remove this section from the attendance migration; verify dependencies against the TEST schema instead.

2. **Existing-table grants/policies need a baseline diff.** The draft grants SELECT/INSERT/UPDATE on `profiles` and SELECT on `user_roles` to authenticated, and adds policies when a particular policy name is absent. It does not prove that existing policies or grants are equivalent. An additive migration must not widen existing identity access as a side effect.

3. **The documented feature scope is incomplete.** The draft contains shifts, sessions, breaks, tasks, task items, requests and audit logging, but does not define a full geofence configuration/event model, entry/exit alerts, owner notification delivery records, selfie-verification flow with no image retention, optional QR verification, or the one-month retention policy as a scheduled and verified job. The maintenance function alone does not schedule itself.

4. **Owner-only requirements need explicit enforcement review.** The draft describes both Owner and admin as managers. The approved product requirements include Owner-controlled switches and an Owner-only dashboard. Before finalizing policies and server functions, separate Owner-only controls from any explicitly approved manager permissions. Do not assume every admin should control GPS, verification or retention settings.

5. **RLS/function review is still required.** Before approval, review every SECURITY DEFINER function for fixed `search_path`, caller identity from `auth.uid()`, role checks, argument validation, grants/revokes, and safe transaction/concurrency behaviour. Verify all tables have the intended RLS policies, direct writes are denied where required, and the audit log cannot be altered by ordinary users.

6. **GPS/selfie/QR are privacy-sensitive.** Store location/verification outcomes and minimal evidence needed for an audit; do not store selfie image bytes or persistent photo URLs. Define retention and deletion for location events and notifications separately. Browser geolocation must be permission-based and checked server-side for plausibility; client coordinates alone are not proof of presence.

7. **Schema compatibility is unverified.** The repository draft assumes several existing identity helpers/types and an extension. Before producing an executable migration, collect a read-only inventory of TEST tables, columns, constraints, indexes, extensions, grants, RLS policies, and function signatures; compare it with the proposed objects. Do not infer compatibility from table names.

## Safe migration plan

- **Phase A — Read-only preflight:** verify the active TEST Supabase reference; inventory existing attendance and identity objects; inspect grants/policies/functions and current attendance data counts. Abort if the project reference cannot be positively verified.
- **Phase B — Attendance-only schema:** create only new, namespaced `attendance_*` objects, indexes, constraints, triggers and policies. Do not change existing identity tables/functions or existing grants/policies. If a dependency is missing, stop and report it rather than silently altering it.
- **Phase C — Feature gaps:** add explicit settings and records for enable/disable switches, geofence/radius, entry/exit/re-entry events, notification attempts, QR challenges, selfie verification outcomes (metadata only), and retention execution status. Do not include secret QR tokens or raw photos in audit payloads.
- **Phase D — Security and test harness:** test unauthenticated, staff-own-row, staff-other-row, admin, owner, service-role, replay/double-punch, overlapping shifts, overnight shifts, clock manipulation, geofence boundary/accuracy, notification failure/retry, and retention dry-run behaviour.
- **Phase E — Separate approval:** present the final migration diff, dependency diff, expected object list, rollback strategy and test evidence. Request a separate explicit approval before running SQL against TEST. Request another explicit approval before any deployment. Production remains untouched.

## Acceptance gates before calling this final

- Build and scoped lint pass; full-repository lint failures are triaged without bulk formatting unrelated files.
- Migration is statically parsed and reviewed; a disposable TEST clone or isolated database validates clean install and re-run behaviour.
- RLS/function permission matrix passes with real test identities.
- Clock-in/out, shift CRUD, task workflow, GPS event handling, notification retries, optional QR/selfie checks, and retention tests pass repeatedly.
- Owner dashboard reads real TEST rows with the expected fields; no production credentials or endpoint are used.
- No SQL execution, database mutation, deployment or PR merge occurs without its separate approval.
