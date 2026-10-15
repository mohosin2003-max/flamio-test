# FLAMIO ATTENDANCE MASTER — Acceptance & Regression Test Matrix

Status: planning artifact only. These tests have **not** been executed against Supabase.
Target environment: TEST project `avwrptztixaketchgmsh` only. Never run against Production.

## Gate 0 — Environment and schema (must pass before feature work)
- [ ] Confirm active Supabase project ref is exactly `avwrptztixaketchgmsh`.
- [ ] Read-only inventory: attendance table columns, primary/foreign keys, indexes, constraints, RLS, policies, grants, extensions, function signatures, and scheduled jobs.
- [ ] Compare live TEST schema to `attendance_master_schema.sql` and `attendance_master_additive_extension.sql`.
- [ ] Confirm existing Owner role model and auth middleware are unchanged.
- [ ] Stop if any dependency differs; do not auto-alter identity tables/functions.
- [ ] Apply migration only after a separate approval, then verify all objects and re-run migration validation in an isolated clone first.

## Gate 1 — Build and static checks
- [ ] `npm run build` passes on the current branch.
- [ ] Attendance-scoped ESLint passes.
- [ ] Full-repository lint baseline recorded; unrelated formatting is not bulk-rewritten.
- [ ] Generated route tree agrees with file-based routes.
- [ ] No client bundle contains service-role keys or server-only imports.

## Gate 2 — Role and data isolation
- [ ] Anonymous user cannot read or write any attendance data.
- [ ] Staff can read only their own shifts, sessions, breaks, tasks and requests.
- [ ] Staff A cannot read or mutate Staff B's records by changing IDs.
- [ ] Staff cannot set their own verification status, verified_by, punch timestamps, worked/late minutes, role, or assigned_by.
- [ ] Admin/manager rights match explicitly approved requirements; Owner-only settings remain Owner-only.
- [ ] Owner dashboard access is rejected server-side for non-owners, even with a direct URL/server-function call.
- [ ] Audit log is append-only to normal users; sensitive payloads and secrets are absent.
- [ ] All SECURITY DEFINER functions use a fixed safe search_path, validate auth.uid(), validate inputs, and have least-privilege EXECUTE grants.

## Gate 3 — Schedule and shifts
- [ ] Owner can create/update/cancel a shift for a staff member; staff cannot change roster.
- [ ] Duplicate/overlapping shifts for the same staff member are rejected.
- [ ] Overnight shifts use Asia/Dhaka and assign the correct duty date.
- [ ] Grace period, early clock-in window, break duration and per-date overrides are correct.
- [ ] Schedule change is audited and old history remains available.

## Gate 4 — Punches and breaks
- [ ] Valid clock-in matches the right shift and uses server time, never a client-supplied timestamp.
- [ ] Duplicate/double clock-in is rejected under concurrent requests.
- [ ] Clock-out without an open session is rejected.
- [ ] Too-fast punches, future punches, >24h sessions and overlapping sessions are rejected.
- [ ] Break start/end is tied to the active session and cannot overlap or fall outside it.
- [ ] Clock-out closes an open break safely.
- [ ] Late/early/overtime/worked/break minutes are recalculated correctly.
- [ ] A verified session is locked until an authorized Owner review/unverify.

## Gate 5 — Tasks and requests
- [ ] Owner assigns and updates tasks/checklists; staff cannot reassign or alter another staff member's tasks.
- [ ] Staff can mark only assigned items and submit completion notes.
- [ ] Verification-required tasks remain pending review until approved.
- [ ] Leave, missed-punch, correction and overtime requests validate shape, dates, overlap and review authority.
- [ ] Every state transition is audited.

## Gate 6 — GPS, QR, selfie, alerts
- [ ] GPS is opt-in/permission-based and works only when the Owner feature switch is enabled.
- [ ] Validate coordinates, accuracy, distance and timestamps server-side; do not treat browser coordinates alone as proof.
- [ ] Test geofence enter/exit/re-entry, boundary jitter, denied permission and unavailable GPS.
- [ ] Selfie verification is ephemeral; no image bytes, permanent image URL or biometric template is retained.
- [ ] QR challenges store only hashes, expire quickly, are single-use, and reject replay.
- [ ] Owner push/in-app notifications are recorded; delivery failures retry with bounded attempts and safe error codes.
- [ ] Notification failures do not corrupt attendance transactions.
- [ ] No GPS/photo/QR secrets appear in logs or client responses.

## Gate 7 — Retention and reliability
- [ ] Dry-run reports eligible records without deleting anything.
- [ ] Retention policy and legal/business exceptions are approved before any deletion job exists.
- [ ] One-month retention covers every sensitive attendance event table consistently.
- [ ] Cleanup is scheduled, observable, retry-safe and produces an audit record.
- [ ] Timezone boundaries, month rollover, DST assumptions, nulls and large datasets are tested.
- [ ] Repeat the critical tests at least three times, including concurrent punches and notification retry.

## Gate 8 — Release
- [ ] All previous gates pass with attached CI logs and TEST evidence.
- [ ] No Production endpoint or secret is used.
- [ ] Migration diff, rollback strategy and residual risks are reviewed.
- [ ] PR remains Draft until user approves readiness; do not merge or deploy without explicit approval.

## Known current blockers
1. No confirmed direct TEST Supabase connection/read-only schema output is available in this workflow.
2. The existing core SQL is a review draft and has not been proven compatible with the actual TEST schema.
3. The feature-extension SQL is also review-only; its policies, grants, extension availability and table compatibility need a real schema diff.
4. Push subscription delivery, geofence checks, ephemeral selfie verification, QR consumption, and scheduled retention are not yet integrated end-to-end.
5. CI logs for the latest branch head have not been confirmed by the available GitHub status response. A prior Build passed, but that does not certify the current full feature set.

No SQL, data mutation, deployment, or merge is authorized by this test plan.
