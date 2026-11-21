# Check-in Photo Evidence (TEST requirement, replaces "Face Verification")

- No face recognition, no biometric face matching, no liveness detection.
- Staff take a live photo with the device camera during check-in (when the Owner switch is ON).
- Gallery / photo-library upload is not allowed (camera stream capture only; server accepts JPEG bytes ≤10 min old, bound to the staff account, single use).
- Camera can switch between front and rear.
- Photo is stored in the private `attendance-evidence` bucket for Owner review via short-lived signed links.
- GPS/geofence requirements unchanged.
