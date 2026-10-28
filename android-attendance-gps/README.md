# Flamio Attendance GPS — Android test harness

This TEST-only native Android harness is intended to check Android foreground-location permissions, the persistent notification, and GPS updates while the screen is locked.

LIMITATION: this initial harness is not connected to the Flamio web app, TEST Supabase, active attendance sessions, geofence transitions, or Owner alerts. It must not be used for real attendance decisions. Integration and security review are still required.

Build with JDK 17 and Gradle 8.11+: `gradle assembleDebug`. GitHub Actions uploads a debug APK artifact for seven days.

Device test: install the APK; grant location and notification permissions; start the service; confirm the ongoing notification; leave the phone outdoors with the screen locked for 5–10 minutes; refresh the local event log; stop service and confirm notification disappears. Compare results with battery optimization enabled and disabled.