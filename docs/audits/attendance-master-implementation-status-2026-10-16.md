# FLAMIO ATTENDANCE MASTER — Implementation Status & Release Gate

**Updated:** 2026-10-16 (TEST geofence/QR and transactional request-review integration)  
**Decision:** INCOMPLETE — do not merge or deploy  
**Repository:** `mohosin2003-max/flamio-test`  
**Branch:** `feature/attendance-master-safe`  
**TEST Supabase ref:** `avwrptztixaketchgmsh`  
**Production ref:** `wubsldblxvkusauafwfd` — out of scope

## Work completed in the TEST branch

- Owner-only Attendance overview/settings, station and shift management, task assignment/review, and request review.
- Staff workspace for attendance history, clock-in/out, breaks, shifts, tasks/checklists, and leave/correction/missed-punch/overtime requests.
- Owner-controlled switches for geofence, QR verification, selfie verification and attendance alerts.
- Station creation now accepts latitude/longitude and a configurable 25–1000 metre geofence radius; Owner station list shows whether coordinates are configured.
- When geofence is enabled, clock-in requires precise browser location, a station-linked shift, an active station with coordinates, reported accuracy no worse than 50 m, and location within the configured radius. Exact coordinates are not stored in the attendance session or audit log.
- Owner can generate a cryptographically random, single-use station QR challenge that expires after 60 seconds. QR table stores only SHA-256 hashes; the Owner UI renders a QR code and provides a manual token fallback.
- When QR verification is enabled, clock-in hashes the submitted token and consumes it with a single conditional database UPDATE bound to the assigned station; concurrent/replayed or expired tokens should not pass the update. Real-device replay acceptance tests are still required.
- Attendance notification sends now respect the Owner-controlled attendance-alert switch. Existing push delivery remains best-effort and is not yet verified end-to-end.
- TEST-only migration `20261016120000_attendance_security_verification_extension.sql` applied: Owner-only settings policy, phone-free team directory RPC, verification settings, station geofence columns, QR challenge storage and initial atomic consume RPC.
- TEST-only migration `20261016130000_attendance_helper_acl_hardening.sql` applied: fixed search_path for timestamp helpers and removed PUBLIC/anon execution from manager/member helpers.
- TEST-only migration `20261016140000_attendance_qr_station_binding.sql` applied: binds QR challenge consumption to the expected station.
- TEST-only migration `20261016150000_attendance_request_review_service_bridge.sql` applied: adds a service-role-only, Owner-verified bridge to the existing transactional request-review function, so approved leave/missed-punch/correction/overtime requests are applied through the database's validation logic.
- The bridge's negative authorization check was exercised with a random non-Owner ID and correctly rejected it before any request mutation.
- Supabase migration history confirms all four migrations are recorded in TEST. No attendance-session data deletion, retention scheduler, deployment, PR merge or Production mutation occurred.
- PR #1 remains Draft and unmerged.

## CI verification

- Earlier commit `df868a927050360346932765645c50028ca89be8` passed dependency install, build/route generation, TypeScript check and scoped ESLint.
- Latest implementation commits add Owner switches, station coordinates, QR rendering/issuance, geofence/QR clock-in enforcement, and notification toggle handling. GitHub Actions run [Attendance branch validation](https://github.com/mohosin2003-max/flamio-test/actions/runs/38872233850) completed successfully for commit `169705fd0cc9620ac5faf4e5d0e40dde22e3ddb5`: dependency install, build/route generation, TypeScript check and scoped ESLint all passed.
- After direct-RPC ACL hardening, the Security Advisor dropped from 18 to 4 authenticated-callable SECURITY DEFINER functions: attendance_is_manager, attendance_is_member, claim_owner, and has_role. These are retained for current RLS/role/bootstrap behavior and still need careful design review rather than blanket revocation. The policy-less QR table is intentionally closed to direct client access. Leaked-password protection remains disabled in TEST Auth settings.

## Remaining release blockers

1. **Role/RLS tests:** Direct-execute privileges for 14 Attendance RPCs were verified denied to anon and authenticated; all 10 Attendance tables have RLS enabled; Owner-only settings UPDATE policy verified. Full HTTP-level Anonymous/Staff/Admin/Owner own-row/other-row and direct-server-function abuse tests still need real signed-in sessions.
2. **QR real-device acceptance:** verify camera scan/manual token flow, 60-second expiry, replay rejection, wrong-station rejection, concurrent requests, and behavior if QR is consumed but the later attendance insert fails.
3. **GPS acceptance:** test Android/browser permission denial, high accuracy, geofence boundary, unavailable GPS, station coordinate errors, and spoofing limitations. Browser coordinates alone are not strong proof of physical presence.
4. **Selfie verification:** switch exists but no identity verification flow is implemented. Do not retain selfie bytes, permanent photo URLs or biometric templates.
5. **Notifications:** delivery records, retries, Owner loud-sound behavior and push delivery verification remain incomplete.
6. **Requests:** approvals are not fully applied to underlying shift/session data for every request type.
7. **Scheduling:** recurring weekday schedules, date-specific overrides, leave/calendar integration and full schedule history remain incomplete.
8. **Retention:** no session purge function or scheduler was added or run. Define retention scope, exceptions, dry-run and audit requirements before destructive cleanup.
9. **Task integration:** test all task transitions against database CHECK constraints and Owner verification/rejection.
10. **Current-head CI and acceptance:** latest CI passed on 15ec33a126c58e81f795aac4b5dfa733264f23c8. Read-only SQL helper checks passed: 75-minute, 8-hour overnight and zero-minute calculations; Dhaka local-date conversion across a UTC boundary; all 10 Attendance tables have RLS. These do not replace repeated signed-in HTTP/device acceptance tests.

## Release gate

**Not production-ready.** Keep PR #1 Draft and unmerged. Continue only on this repository branch and TEST project. Any destructive retention work, deployment, or PR merge requires separate explicit approval. Never target Production ref `wubsldblxvkusauafwfd`.


## Additional TEST verification (2026-10-16, latest)

- TEST-only migration attendance_rpc_acl_hardening applied and recorded; direct authenticated and anon execution denied for 14 Attendance SECURITY DEFINER RPCs, while service_role retains execute.
- Security Advisor count for authenticated-callable SECURITY DEFINER functions reduced from 18 to 4 (attendance_is_manager, attendance_is_member, claim_owner, has_role). Remaining helper/bootstrap exposure is not declared clean.
- Read-only checks confirmed all 10 Attendance tables have RLS, the Owner-only settings policy has both USING and WITH CHECK, QR challenge table has no client policies, and service-only request-review bridge is not executable by anon/authenticated.
- Pure SQL calculation checks: 75 minutes, 480 minutes across an overnight interval, zero for a zero-length interval, and Asia/Dhaka date conversion passed.
- No live attendance session/task/request rows were created or deleted by these checks. No retention purge, scheduler, deploy, merge, or Production change occurred.
