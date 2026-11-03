# FLAMIO ATTENDANCE MASTER — Final Audit

**Date:** 2026-10-28  
**Scope:** TEST repository `mohosin2003-max/flamio-test`, TEST Supabase project `avwrptztixaketchgmsh`, and native companion repository `mohosin2003-max/Flamio-Ordering-Foundation.OS`. Production is explicitly out of scope.

## Executive decision

**Audit activity complete; release readiness is NOT READY.** Relevant feature branches have successful CI evidence, but they are still Draft/unmerged. Automated tests do not replace real role-isolation, notification delivery, or Android acceptance tests.

## GitHub and CI state

- TEST main: `57e2a6c361ecbd1c822d99b2f9c33f9385d7230b`.
- PR #14 Owner Alerts: Draft/unmerged — https://github.com/mohosin2003-max/flamio-test/pull/14
- PR #15 GPS Exit/Return Report: Draft/unmerged — https://github.com/mohosin2003-max/flamio-test/pull/15
- PR #16 Automated GPS tests: Draft/unmerged — https://github.com/mohosin2003-max/flamio-test/pull/16
- Task 4 CI passed: https://github.com/mohosin2003-max/flamio-test/actions/runs/40721312065
- Task 5 CI passed on PR #16 head: build/route generation, TypeScript, scoped lint, and the pure test suite (reported 231 passing tests): https://github.com/mohosin2003-max/flamio-test/actions/runs/40723817683
- Native Android PR #1 is Draft/unmerged; build workflow succeeded, but real-phone acceptance has not been done: https://github.com/mohosin2003-max/Flamio-Ordering-Foundation.OS/pull/1

CI success on a PR branch does not mean the changes are merged or deployed. No PR was merged in this audit.

## TEST Supabase state

Observed settings: Asia/Dhaka timezone; attendance, tasks, geofence and alerts enabled; selfie and QR verification disabled; retention_days constrained to 30.

Observed row counts:
- attendance_location_events 0
- attendance_sessions 0
- attendance_tasks 0
- notifications 0
- push_tokens 0
- notification_jobs 0
- notification_push_deliveries 0
- attendance_audit_log 155
- attendance_shifts 62
- attendance_stations 1

The attendance-evidence storage bucket exists and is private, with a 1,500,000-byte file-size limit. Zero rows in the GPS/session/notification tables mean there is no persisted end-to-end sample proving real GPS transitions or push delivery; this alone does not prove code failure.

The TEST migration history contains 15 versions, including the location report and owner-alert migrations. The owner-alert migration is applied in TEST but its repository change remains in Draft PR #14 rather than main. Reconcile migration files/history before release; do not blindly replay already-applied migrations.

## Retention and scheduled jobs

The only matching attendance cron job observed was `attendance-task-photo-orphan-sweep`, active daily at 03:00. No scheduled job for monthly evidence-photo deletion or approximately quarterly old attendance/task record deletion was found.

Unit tests exist for retention logic, but do not prove a scheduler invokes it. Automatic deletion is destructive: before enabling it, define eligible rows/files, exact age boundary, storage-first ordering, failure/retry behavior, and TEST-only dry-run counts. No data was deleted in this audit.

## Security Advisor

Observed warnings:
1. Five SECURITY DEFINER functions are executable by authenticated: `attendance_is_manager(uuid)`, `attendance_is_member(uuid)`, `attendance_verify_session(uuid,text,text)`, `claim_owner(uuid)`, and `has_role(uuid,app_role)`.
2. RLS is enabled without policies on `attendance_qr_challenges`, `notification_jobs`, and `notification_push_deliveries`.
3. Leaked-password protection is disabled.
4. `pg_net` is installed in the public schema.

The policy-less tables may be intentionally service-role-only. The helper functions are used in RLS policies and some have explicit authorization guards. Blanket revokes/policies could break intended flows; verify with non-owner accounts and direct RPC tests before narrow changes. No grants, policies, Auth settings, or extensions were changed.

## Performance Advisor

- 17 unindexed foreign-key findings.
- 18 RLS initialization-plan findings.

These are optimization warnings, not proof of an authorization bypass. No indexes were added or dropped.

## Tracked environment file

The inspected tracked `.env` contains TEST URL, publishable Supabase keys and a VAPID public key; no service-role key was present. These are public/client-side configuration values. For hygiene, move to a tracked `.env.example` and ignore local `.env`; do not rotate keys without evidence of exposure or an approved rotation plan.

## Remaining acceptance gates

1. Reconcile repository migration files with the 15 applied TEST migrations.
2. Test RLS/authorization negatives: anonymous, staff A vs staff B, manager/admin vs owner, and direct RPC calls.
3. Prove in-app and real push alert delivery, duplicate suppression, retry, and disabled-alert behavior.
4. Verify real persisted GPS exit/return events, unreturned exits, date boundaries, report accuracy, pagination and export.
5. Implement/test the requested monthly photo and approximately quarterly record retention only after safe scope/failure behavior is reviewed; never run destructive cleanup on live.
6. On the real Android phone test permissions, screen-off/background behavior, battery restrictions, GPS/network loss and recovery, duplicate samples, and persisted events.
7. Rerun CI on the exact commit intended for merge; keep PRs Draft/unmerged until gates pass.

## Change-safety statement

This audit used read-only GitHub/Supabase catalog/Advisor/CI reads. It did not alter Supabase data, run migrations, change Auth settings, modify grants/policies, delete storage, rotate keys, merge PRs, or deploy production. This file is the only change made for the audit, on a separate TEST-repository branch.
