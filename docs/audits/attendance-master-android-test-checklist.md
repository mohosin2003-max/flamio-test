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

## Attendance Master additions (offline, QR, roster, breaks, reports)
Record Pass/Fail, phone model, Android and Chrome version for each. Use only TEST accounts.

### A. Offline queue and reconnect
- A1. Signed in as TEST Staff, open My duty online. Note the shown status.
- A2. Turn on airplane mode. The red "You are offline" note must appear.
- A3. Tap Clock in. Expect warning "saved on this phone… NOT recorded until it shows Confirmed" and a **Pending** row with the tap time.
- A4. Tap Clock in again while Pending: must be refused ("already waiting to sync"). No duplicate row.
- A5. Close and reopen the browser tab while still offline. Pending row must still be there (if a "cannot store offline punches safely" note shows, record Fail for persistence on that browser).
- A6. Turn airplane mode off. Row goes Syncing → Confirmed; the Owner sees one session with the **server** time (sync time, not tap time).
- A7. Offline: Start break, then End break, then Clock out. On reconnect they must sync in that order; none may overtake an earlier one.
- A8. Lost reply: on a slow/flaky network, tap Clock in and drop the connection right after. On retry the row must become Confirmed only if the server shows a clock-in after the tap; if you were already clocked in from earlier, it must show **Failed** with "already clocked in before this tap". Break end is never auto-confirmed — it must show Failed with "check your status".
- A9. Failed row: tap Retry once; confirm it does not create a second record.

### B. Airplane mode edge cases
- B1. Airplane mode with Wi‑Fi re-enabled but no internet: queued rows must stay Pending, not Confirmed.
- B2. Sign out while a row is Pending, sign back in: no punch may be recorded under another account.

### C. QR scanner and camera permission
- C1. With QR verification ON, tap Scan station QR; Chrome asks for camera. **Allow** → scan a fresh TEST station QR → clock-in succeeds.
- C2. **Deny** camera → a clear message appears and manual token entry still works.
- C3. Reuse the same QR token or wait past expiry → rejected.
- C4. Offline QR clock-in → must be refused ("QR clock-in needs a live connection"), never queued.

### D. Roster preview (Owner → Attendance Reports & Tools)
- D1. Choose staff, dates (≤62 days), weekdays, times; tap Preview shifts. List shows each date; overnight shifts marked.
- D2. Shifts that overlap existing ones are struck through and counted as skipped.
- D3. Change any field → "Settings changed — preview again" and Confirm disappears.
- D4. Confirm and create → number created equals preview "new" count; nothing created before confirming.

### E. Break alerts
- E1. Shift with planned break 15 min: stay on break 20 min. Staff sees "Scheduled limit exceeded… 5 min over"; Owner Needs attention shows red **Scheduled limit exceeded**, scheduled 15, over by 5.
- E2. Unscheduled clock-in, break 35 min: Owner shows **Possible long break (unscheduled estimate)**, 30-min estimate; staff sees the estimate note.
- E3. Shift with planned break 45 min, break 35 min: no alert.
- E4. Alert managers twice: second press must not send duplicate push for the same break.

### F. Report filters and CSV export
- F1. Set From/To and Group by Day, Week (starts Saturday), Month; totals change accordingly.
- F2. Open sessions shown as "(n open)" and excluded from worked time; overtime only for scheduled sessions.
- F3. Tap CSV on the phone; file downloads and opens in a spreadsheet app with matching numbers.
- F4. A staff name beginning with "=" must appear as plain text in the spreadsheet, not a formula.
- F5. Signed in as Staff, the reports page must be inaccessible.

### Known limits (do not mark as Pass)
- Face/selfie verification and background arrival/departure tracking are not implemented.
- The attendance/tasks on/off columns are not yet in the TEST database (migration pending review); toggles behave as ON.

## Acceptance rule
Do not merge or deploy if any role boundary, duplicate punch, QR replay, privacy, or data-integrity test fails. Capture exact errors without sharing passwords, tokens, QR secrets, or service-role keys. Only after all required checks pass should a separate live-test plan be approved.
