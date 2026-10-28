# Flamio Attendance GPS — TEST only

This native Android test app connects to the TEST Supabase project `avwrptztixaketchgmsh`, signs in with a TEST Staff account, and sends GPS transition readings to the `attendance-gps-transition` Edge Function.

## Test flow
1. Deploy the `attendance-gps-transition` function to TEST Supabase (the project function runtime supplies its own server environment variables).
2. Install the debug APK and sign in with a dedicated TEST Staff account; never use production credentials.
3. Start a Duty in the TEST Attendance web app. The shift must be assigned to an active station with coordinates and geofence radius, and geofence must be enabled.
4. Grant precise location and background location when Android asks; allow notifications.
5. Start GPS in this app. It runs an Android location foreground service and refreshes the Supabase session when the access token is close to expiring.
6. The first accurate reading inside the station creates `geofence_enter`; crossing outside creates `geofence_exit`; returning inside creates `reentry`. Raw coordinates are not stored. The event table stores only transitions, time, distance and accuracy.
7. View the Owner GPS movement report in the TEST web app.

## Safety / current limits
- TEST only; do not enter production credentials. The app's private preferences retain session tokens for the foreground service; use a dedicated disposable TEST Staff account.
- No database migration is run by this app. The existing `attendance_location_events` table must already exist.
- GPS readings are persisted locally in a bounded FIFO queue and retried after connectivity returns, on service restart, and periodically. Readings rejected by the server are kept in a visible held list with coordinates removed; check the held list in the app log/status before treating a trip as recorded.
- The repository's proposed Edge Function change accepts queued readings up to 24 hours old only when the captured timestamp matches the staff member's attendance session window. This behavior is NOT active in TEST until the Edge Function change is reviewed and deployed; the currently deployed version may still reject readings older than 2 minutes. Readings older than 24 hours or outside a session are rejected and held for review.
- The queue is limited to 500 pending readings and 200 held entries; when the pending queue is full, the newest reading cannot be stored and a `QUEUE_FULL` log entry is written.
- A server acceptance response does not prove the GPS transition was recorded: `no_transition` and other `recorded: false` responses are acknowledged by the endpoint. Review the event log and Owner report, especially after offline periods.
- Background location depends on Android permissions and battery settings; physical device verification is still required.
