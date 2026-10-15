# FLAMIO ATTENDANCE MASTER — Implementation Status & Release Gate

**Updated:** 2026-10-16  
**Decision:** INCOMPLETE — do not merge or deploy  
**Repository:** `mohosin2003-max/flamio-test`  
**Branch:** `feature/attendance-master-safe`  
**TEST Supabase ref:** `avwrptztixaketchgmsh`  
**Production ref:** `wubsldblxvkusauafwfd` — out of scope

## Work completed in the TEST branch

- Owner-only Attendance overview page with an editor for existing settings fields: late grace, early punch window, minimum punch gap, maximum session hours, and unscheduled clock-in.
- Server-side Owner authorization for settings updates, station/shift management, task assignment/review, and request review.
- Station creation and enable/disable.
- Staff shift scheduling and cancellation; input validation, Asia/Dhaka time conversion, overnight support, active-station/staff-role checks, overlap check, and maximum shift duration.
- Staff workspace for own attendance history, clock-in/out, breaks, today's shift list, assigned tasks, interactive checklist items, and leave/correction/missed-punch/overtime requests.
- Owner workflow UI for task assignment with checklist items, task verification/return, and request approve/reject.
- Audit-log inserts are attempted for the main attendance mutations. Logging failures are recorded to server logs; they do not roll back the primary mutation.
- Expanded GitHub Actions validation workflow to build and lint the Attendance implementation files.
- PR #1 body updated to reflect the actual implementation and remaining gaps.

## TEST database safety and live state

- Read-only policy query still shows `attendance_settings_manager_update` using `attendance_is_manager(auth.uid())`. This policy has NOT been changed. The Owner-only SQL correction remains review-only and requires separate explicit approval before execution.
- No SQL or migration was executed. No schema, policy, grants, or live data was changed. No live attendance write test was performed.
- No production deployment or production database mutation occurred.
- PR #1 remains Draft and unmerged.

## Verification evidence and limits

- GitHub workflow-run lookup for the latest checked PR head returned no workflow runs.
- Combined commit status lookup returned no status checks.
- Therefore build/lint/typecheck success is NOT established. Do not claim CI passed.
- No end-to-end tests with separate Owner/Admin/Staff accounts were run. No 3–4 successful test cycles can honestly be claimed.
- The read-only TEST database policy inventory confirms the settings RLS issue remains unresolved.

## Remaining release blockers

1. **Security/RLS:** separately approve and apply the Owner-only settings policy correction in TEST; test Owner vs Admin/Staff access. Review the manager helper and the `attendance_team_directory()` phone-number exposure.
2. **Feature switches:** schema-backed toggles for geofence/GPS, selfie, QR and task workflow are not implemented in the live schema/UI.
3. **Geofence/GPS:** no complete server-validated location event pipeline, configurable radius, entry/exit/re-entry alerts, or abuse/spoofing controls.
4. **Notifications:** no completed push/in-app delivery worker, retry/idempotency strategy, owner sound alert, or delivery verification.
5. **Selfie/QR:** no end-to-end ephemeral selfie verification or single-use QR challenge creation/consumption/replay-prevention implementation. The review-only additive SQL draft is not applied.
6. **Retention:** automatic one-month deletion is not installed or verified. No cleanup/deletion job was run.
7. **Scheduling:** editing, recurring weekday schedules, date-specific overrides, leave/calendar integration, and full schedule history are incomplete.
8. **Request workflow:** approve/reject decisions are recorded, but all request types do not yet apply the approved changes to attendance/leave/overtime records.
9. **Testing:** run and capture the current CI build and scoped lint; add repeatable unit/integration/end-to-end tests for authorization, shifts, clock-in/out, breaks, tasks, requests, notification delivery, QR replay, privacy, retention, and regressions.

## Release gate

**Not production-ready.** Keep PR #1 Draft and unmerged. Continue only on this repository branch and TEST project. Before any database mutation, explain exact impact and rollback in Bengali and obtain separate explicit approval. Never target Production ref `wubsldblxvkusauafwfd`.
