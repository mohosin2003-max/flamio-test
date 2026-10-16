# FLAMIO ATTENDANCE MASTER — TEST Final Audit Snapshot

**Audit date:** 2026-10-16  
**Status:** NOT READY FOR PRODUCTION — READ-ONLY AUDIT ONLY  
**Repository:** `mohosin2003-max/flamio-test`  
**Branch:** `feature/attendance-master-safe`  
**Supabase TEST ref:** `avwrptztixaketchgmsh`  
**Production ref:** `wubsldblxvkusauafwfd` — explicitly out of scope.

## Change-safety statement

This audit used read-only Supabase inventory, catalog queries, and Advisor calls against TEST ref `avwrptztixaketchgmsh`. No DDL, DML, migration, deletion, deployment, or production database operation was run. The only repository change associated with this report is this audit document on the TEST repository branch. PR #1 remains Draft and unmerged.

## Verified findings

- TEST project `Flamio-test` is ACTIVE_HEALTHY, PostgreSQL 17.11.
- Public schema inventory contains nine `attendance_*` tables plus `profiles` and `user_roles`; all nine attendance tables have RLS enabled.
- Existing core attendance tables include settings, stations, shifts, sessions, breaks, tasks, task items, requests, and audit log.
- TEST migration list returned empty, while the attendance schema exists. This means migration history is not currently a reliable representation of the live schema.
- Supabase reports no Edge Functions for TEST.
- Supabase Security Advisor reports:
  - 2 functions with mutable search_path: `attendance_local_date`, `attendance_minutes`.
  - 17 SECURITY DEFINER functions executable by authenticated users. This is a review warning, not proof that every function is exploitable; each function must be reviewed for auth.uid(), authorization, input validation, and least-privilege grants.
  - Leaked-password protection is disabled.
- Performance Advisor reports 11 unindexed foreign keys, 18 RLS init-plan warnings, four tables with multiple permissive policies, and 19 currently unused indexes. Do not remove indexes solely from the unused-index finding because the attendance tables are empty or nearly empty.
- Existing policy `attendance_settings_manager_update` uses `attendance_is_manager(auth.uid())`; the database's manager helper treats both owner and admin as managers. This does not meet the approved Owner-only control requirement for Attendance feature switches unless restricted in a reviewed change.
- Current settings row has Asia/Dhaka timezone, 10-minute grace period, 60-minute early clock-in window, 60-second punch gap, 16-hour maximum session, and unscheduled clock-in enabled.
- PR #1 is open, Draft, unmerged. It explicitly describes a read-only dashboard scaffold and says full features are not implemented.
- GitHub combined status and workflow-runs lookups for the audited head returned no check statuses/runs. Therefore no current-head CI pass can be claimed.
- No attendance-specific Supabase Edge Functions were returned. The additive SQL draft has not been applied and does not implement the server-side workflows or scheduler by itself.

## Release blockers

1. Complete owner-only settings authorization design and verify every privileged RPC.
2. Review all SECURITY DEFINER functions, especially role helpers and manager actions; do not blanket-revoke functions required by normal workflows.
3. Add and integrate scheduling CRUD, staff-facing punches/breaks/tasks, GPS/geofence, ephemeral selfie verification, one-time QR challenge handling, push/in-app alerts, and owner dashboard actions.
4. Implement and test the approved one-month retention policy. No deletion or scheduled cleanup is enabled by this audit.
5. Validate RLS isolation for anonymous users, staff A vs staff B, admin/manager vs owner, and direct RPC calls.
6. Establish reproducible migration history and reconcile it with the live TEST schema before any migration.
7. Run build, scoped lint, full-lint baseline, and end-to-end tests; capture actual logs.
8. Keep PR #1 Draft and do not merge/deploy until all gates pass and the user explicitly approves.

## Required safety gate before database changes

Any SQL that alters schema, policies, grants, functions, schedules, or data requires a separate user approval after explaining the exact impact and rollback plan. Confirm the active ref is exactly `avwrptztixaketchgmsh` immediately before execution. Never target Production ref `wubsldblxvkusauafwfd`.

## Decision

**NOT PRODUCTION-READY.** This report is an evidence snapshot, not a certification that all runtime behavior has passed. The safe next step is a code/security review and test implementation on the TEST branch, followed by a separate, explicitly approved TEST-only migration after preflight.
