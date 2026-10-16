# FLAMIO ATTENDANCE MASTER — TEST Migration Review

**Status: Initial security/verification migration applied to TEST; full feature migration remains incomplete.**  
**Target:** TEST project `avwrptztixaketchgmsh` only.  
**Production project `wubsldblxvkusauafwfd`: explicitly out of scope.**

## Applied migration and verification

The versioned migration `supabase/migrations/20261016120000_attendance_security_verification_extension.sql` was applied to TEST on 2026-10-16. Supabase migration history reports version `20261016074823`, name `attendance_security_verification_extension_20261016`.

Read-only post-migration checks confirmed:
- `attendance_settings_owner_update` exists and both USING/WITH CHECK require Owner role.
- `has_role(uuid, app_role)` execution is revoked from PUBLIC/anon and granted to authenticated/service_role.
- `attendance_team_directory()` no longer returns staff phone numbers; it returns user ID, full name and roles.
- Geofence/verification settings columns and station latitude/longitude/radius columns exist.
- `attendance_qr_challenges` exists with hash-only token storage, expiry/consumption constraints, RLS enabled and no direct PUBLIC/anon/authenticated table privileges.
- QR consume RPC uses fixed `search_path`, validates caller role and token-hash format, and atomically consumes a valid unexpired challenge.

The migration did not delete attendance data, create a retention scheduler, deploy the app, merge the PR, or target Production.

## Important limitations

1. This is not a complete Attendance Master schema migration. Do not run `attendance_master_schema.sql` as-is.
2. The existing schema draft mixes identity and authorization changes into attendance setup (including role types/tables, profiles, grants and owner-onboarding helpers). Those must not be casually replaced or widened as part of a later attendance migration.
3. The new QR challenge table is storage and atomic consumption only. QR issuance, cryptographically random raw token creation, short expiry, UI and clock-in integration are not implemented end-to-end.
4. Geofence fields exist, but GPS capture, server-side distance validation, entry/exit/re-entry event records and notifications are not wired up.
5. Selfie verification is not implemented. Do not persist selfie bytes, permanent photo URLs or biometric templates.
6. Retention scheduling and deletion are deliberately not included. No destructive cleanup function has been scheduled or run.
7. SECURITY DEFINER functions and direct RLS policies still require a full role matrix test with separate Anonymous/Staff/Admin/Owner accounts.
8. The team-directory RPC contract changed. Search all callers and run runtime integration checks before release.
9. Existing settings-read policy remains available to authenticated members by design; settings updates are now Owner-only.
10. Do not infer runtime safety solely from a successful SQL apply or build.

## Remaining safe plan

- Test migration re-run behavior in an isolated clone before treating it as generally repeatable. Function drop/recreate is intentional for the team-directory return contract and is not a zero-impact operation.
- Verify all app callers of `attendance_team_directory()` and validate server authorization/RLS with distinct test accounts.
- Implement Owner UI for the new switches and geofence settings.
- Add GPS event pipeline, notification delivery records/retries, QR issuance/clock-in integration, and a reviewed ephemeral selfie verification flow if required.
- Define retention scope, legal/business exceptions, dry-run, auditability and scheduling before creating any destructive job.
- Implement complete request application, recurring schedules/date overrides and task status integration.
- Run the repository's CI and end-to-end acceptance matrix repeatedly; attach evidence to the PR.
- Keep PR Draft/unmerged and do not deploy until all release gates pass.

Production remains out of scope.