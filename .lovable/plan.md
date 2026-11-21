# Attendance Master — Forgotten Check-out Audit (TEST, read-only)

Scenario: check-in, break start, break end, staff goes home without checking out. No files, database rows, or settings were changed.

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Can the staff close the session later? | PASS with GAP | Check-out (`attendance-workflow.functions.ts` ~313-372) finds the open session and closes it at the **current time**, not the real end of shift, so paid hours come out too high. If the staff is away from the store, the record is marked with a location exception. Staff can then send a `correction` request with a proposed check-out time for Owner approval (~454-474). |
| 2 | Is a new shift blocked while the old one is open? | PASS with GAP | Check-in (~166-188) refuses with "You are already clocked in" until the old session is older than `max_session_hours` (default 16). There is no database rule that allows only one open session per staff, so the block exists only in the app code (two check-ins at the same moment could both succeed). |
| 3 | Can Owner/Manager safely close or correct it? | PARTIAL | The Owner "Recover stale session" button (`ownerRecoverStaleSession`, `AttendanceOwnerTools.tsx`) runs a locked, audited server step. It **only works after max_session_hours** and closes the session at check-in + max hours, not the real time. Exact corrections go through the approval of a staff correction or missed-punch request. The Owner has no direct "set check-out time now" action, and Managers have no access (owner-only). |
| 4 | Does the system close abandoned shifts on its own? | GAP | `attendance_auto_close_stale_session` (migration 20261017170155) is only triggered by the staff's next check-in or by the Owner button. No scheduled job runs it. Owner alerts for missed check-outs (`missedClockOuts`) exist but only fire when the Owner opens the monitor. When it does run, it closes any open break, caps time at check-in + max hours, sets status `missed_punch`, and keeps the record for review (never auto-approved). |
| 5 | Is there a recovery path for the next day's shift? | PASS (conditional) | The next check-in first closes the stale session (capped and marked for review), records an audit entry, then continues. If the gap is shorter than max_session_hours (for example a short overnight gap), the staff is blocked and must check out first, which records an inflated time. |

## Safest production behaviour (recommendation, not implemented)
1. Auto-close on a schedule: every few minutes, close sessions that pass **shift end + a grace period** (for example 2h) or the max hours limit. Use the scheduled shift end as the check-out time (or the last break end/location event), mark them `missed_punch` and "Owner review required", and never count overtime automatically.
2. When the staff checks out late with no shift time to fall back on, ask for the real end time and send it as a correction request instead of saving "now".
3. Add a database rule that allows only one open session per staff.
4. Add an Owner action "Close session at time X" with a required note and an audit entry (optionally for Managers too, with their own audit role).
5. Push a missed check-out alert to the staff and Owner when the shift ends + grace, without waiting for the Owner to open the monitor.
6. Next-day check-in should always work after auto-close. The old record stays marked for review.

No changes will be made unless you approve a follow-up implementation brief.
