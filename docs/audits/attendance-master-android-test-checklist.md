# FLAMIO ATTENDANCE MASTER — Android TEST acceptance checklist

**Environment:** TEST only  
**Repository:** `mohosin2003-max/flamio-test`  
**Branch:** `feature/attendance-master-safe`  
**TEST Supabase:** `avwrptztixaketchgmsh`  
**Production Supabase and live `flamio.bd`: do not use during this checklist.**

## Before using the phone
- Keep PR #1 Draft and do not merge/deploy.
- Sign in only with designated TEST Owner and TEST Staff accounts.
- Confirm TEST staff records and shifts are disposable test data.
- Ensure Owner has turned OFF Selfie Verification for this test build. Selfie capture is not implemented; clock-in intentionally blocks if the setting remains enabled.
- Grant location permission only while using the app. Test first in the restaurant/station area.
- Do not use a real employee's private photo or real attendance records.

## Manual acceptance tests
Record Pass/Fail, device/browser version, and a redacted screenshot for each.

1. **Login/role boundary:** staff can open only staff attendance screens; Owner can open management; ordinary staff cannot open Owner settings.
2. **Clock-in, GPS disabled:** clock in once; a second clock-in must be rejected; server timestamp and duty date should be consistent with Asia/Dhaka.
3. **GPS geofence:** create a TEST station with a known location. Test inside the configured radius and outside the radius; record reported accuracy. Do not treat poor GPS accuracy as a successful boundary proof.
4. **QR:** issue a fresh station challenge; scan it once; confirm the same token is rejected on replay and after expiry. Test manual token entry separately.
5. **Breaks:** start/end break; clock-out must be blocked while a break is open.
6. **Clock-out and recovery:** clock out normally; verify duration. Test stale-session recovery only with a dedicated disposable TEST account and controlled session fixture; never modify a real staff session.
7. **Requests/review:** submit and cancel a pending request as staff; approve/reject as Owner; verify staff cannot review their own request.
8. **Tasks/schedules:** assign a task and shift as Owner; update/complete as staff; check dates around midnight in Asia/Dhaka.
9. **Push/alarm:** test on a foreground tab, background tab, and screen-locked phone; record each separately. Do not assume loud alarms or background geofence events work unless observed.
10. **Privacy:** inspect browser permission prompts and storage/network behavior. No selfie test can pass until an actual capture flow is implemented and audited.
11. **Retention:** do not claim the 30-day deletion requirement passes until an actual scheduler is configured and a controlled retention test is observed.
12. **Owner review:** confirm auto-closed sessions are visibly flagged for review and are not silently treated as normal clock-outs.

## Acceptance rule
Do not merge or deploy if any role boundary, duplicate punch, QR replay, privacy, or data-integrity test fails. Capture exact errors without sharing passwords, tokens, QR secrets, or service-role keys. Only after all required checks pass should a separate live-test plan be approved.
