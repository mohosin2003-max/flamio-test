# FLAMIO ATTENDANCE MASTER — TEST Migration Review

**Status: Four TEST-only security/verification/workflow migrations applied; complete feature release remains blocked.**  
**Target:** TEST project `avwrptztixaketchgmsh` only.  
**Production project `wubsldblxvkusauafwfd`: explicitly out of scope.**

## Applied migrations and verified effects

1. `20261016120000_attendance_security_verification_extension.sql`
   - Owner-only attendance settings UPDATE policy.
   - Removes phone from `attendance_team_directory()`.
   - Adds geofence/verification switches and station coordinates/radius.
   - Adds hash-only QR challenge storage and atomic consumption RPC.
2. `20261016130000_attendance_helper_acl_hardening.sql`
   - Sets explicit `search_path=public` for `attendance_local_date` and `attendance_minutes`.
   - Revokes PUBLIC/anon EXECUTE on `attendance_is_manager(uuid)` and `attendance_is_member(uuid)`, retaining authenticated/service_role access.
3. `20261016140000_attendance_qr_station_binding.sql`
   - Changes the QR consume RPC to bind consumption to an expected station ID and reject wrong-station tokens before marking them consumed.
4. `20261016150000_attendance_request_review_service_bridge.sql`
   - Adds a service-role-only bridge that verifies the supplied actor is an Owner, sets the Owner claim transaction-locally, and invokes the existing transactional request-review function so approved leave, missed-punch, correction and overtime requests use the database's validation/application logic.

Supabase migration history confirms all four migration records exist in TEST. Read-only checks after the first two migrations confirmed the Owner-only policy, new columns, QR challenge table and explicit helper ACL/search_path. The final station-binding migration applied successfully. No attendance-session data was deleted; no retention scheduler, app deployment, PR merge or Production mutation occurred.

## Application integration added after the schema migration

- Owner UI exposes the geofence, QR, selfie and attendance-alert switches.
- Station creation accepts optional latitude/longitude and radius.
- Owner can generate a cryptographically random one-time QR code with a 60-second expiry. Only its SHA-256 hash is stored.
- Staff clock-in requests browser geolocation when geofence is enabled and validates the assigned station/radius on the server.
- Staff clock-in consumes the QR hash through a conditional, station-bound UPDATE when QR verification is enabled.
- Notification sending respects the Owner alert switch.
- The latest CI runs for these later application changes are pending/in progress; earlier CI passed before the newest changes. Do not claim current-head build success yet.

## Important limitations and release blockers

1. QR display/issuance exists, but camera-based scanning and manual token entry require real-device verification. QR is single-use and may be consumed even if a subsequent session insert fails; the user must then generate a new challenge.
2. GPS coordinates from a browser can be spoofed. The current geofence check is a location policy, not tamper-proof proof of presence.
3. Selfie identity verification is not implemented; do not persist images, permanent photo URLs or biometric templates.
4. Push delivery remains best-effort. Delivery receipts, retries, Owner loud-sound behavior and full end-to-end checks are incomplete.
5. Leave/correction/missed-punch/overtime approval does not yet fully apply all approved changes to attendance records.
6. Recurring schedules/date overrides and full task state integration need more implementation and acceptance tests.
7. No session retention purge/scheduler exists. Do not add destructive cleanup until scope, exceptions, dry-run and audit behavior are separately reviewed.
8. Supabase Security Advisor still reports a policy-less QR table (intentional denial of direct client access), 18 authenticated-callable SECURITY DEFINER functions requiring role-by-role review, and the Auth leaked-password protection setting. Do not dismiss the function warnings without reviewing each function and its grants.
9. Run the latest CI to completion and perform real TEST acceptance tests with separate Anonymous/Staff/Admin/Owner identities before any release decision.

## Safety

Do not run `attendance_master_schema.sql` as-is. Do not merge or deploy this PR until every release gate passes. Production remains out of scope.
