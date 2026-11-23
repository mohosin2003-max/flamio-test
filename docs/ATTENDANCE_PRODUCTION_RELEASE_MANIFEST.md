# FLAMIO ATTENDANCE MASTER — Production Release Manifest

Generated from the verified TEST project state.

## Environments

- TEST: avwrptztixaketchgmsh
- Production: psckjmopvxaqvroaltfu

## Production preflight

Production currently has no `public.attendance_*` tables. Therefore this is a NEW subsystem deployment, not an incremental hardening deployment.

## Required migration sequence

The production release must include the Attendance Master base schema and then these dependency-ordered phases:

1. Core attendance schema:
   - attendance_settings
   - attendance_stations
   - attendance_shifts
   - attendance_sessions
   - attendance_breaks
   - attendance_tasks
   - attendance_task_items
   - attendance_requests
   - attendance_location_events
   - attendance_audit_log
   - QR challenge/evidence-related tables
2. Core helper functions/triggers and RLS.
3. QR station binding and request-review bridge.
4. Stale-session recovery and feature toggles.
5. Selfie/evidence storage.
6. Task photo/checklist atomic completion and freshness guards.
7. Location reporting.
8. Evidence retention and cleanup helpers.
9. Duty-end auto-close + overtime reconciliation.
10. Manager review bridge and role-compatibility fixes.
11. Final runtime/security/ACL hardening.
12. Early-departure overtime cancellation.
13. Final settings lock.
14. 20261123 incremental hardening.
15. 20261123 singleton final.

## Critical release rule

Do NOT apply only steps 14–15 to Production. They depend on the Attendance Master schema and earlier functions/tables.

## Current TEST migration history

The TEST project contains the following Attendance migrations:

20261016074823 attendance_security_verification_extension_20261016
20261016075244 attendance_helper_acl_hardening_20261016
20261016080435 attendance_qr_station_binding_20261016
20261016081103 attendance_request_review_service_bridge_20261016
20261016153910 attendance_rpc_acl_hardening
20261017170155 attendance_stale_session_recovery
20261019191216 attendance_feature_toggles
20261020075908 attendance_selfie_evidence
20261020080029 create_private_attendance_evidence_bucket
20261023173648 attendance_phase_b_task_photo_atomic_completion
20261023174220 attendance_phase_b_photo_freshness_guard
20261023180554 attendance_task_photo_orphan_sweep
20261028043142 attendance_location_report
20261028153511 attendance_owner_alert_notifications
20261028193223 attendance_evidence_retention_helpers_20261029
20261028193237 attendance_90_day_record_retention_20261029
20261028193321 attendance_retention_stable_age_basis_20261029
20261028195142 attendance_retention_preserve_unverified_20261029
20261029130039 harden_attendance_expired_evidence_ref_paths
20261029130242 retry_missing_attendance_evidence_objects
20261122052524 20261122070000_attendance_duty_autoclose_overtime_reconciliation
20261122052526 20261122071000_attendance_manager_review_bridge
20261122052836 attendance_autoclose_function_acl_hardening
20261122052902 attendance_manager_review_role_enum_fix
20261122165827 attendance_final_runtime_function_hardening
20261122171553 attendance_final_security_hardening
20261122171651 attendance_overtime_early_departure_final
20261122171718 attendance_acl_cleanup
20261122171938 attendance_final_settings_lock
20261123143025 20261123_attendance_incremental_hardening
20261123144656 20261123_attendance_singleton_final

## Release blockers before Production

Several historical files are explicitly reconstructed snapshots rather than guaranteed byte-for-byte originals. A production migration must therefore be regenerated from the current TEST schema/function/policy state, rather than blindly replaying reconstructed historical files.

The production application code also does not currently contain the Attendance Master implementation in the known production repository. The attendance application code must be ported/released together with the database migration.

## Required next action

Create one clean, production-safe Attendance Master release migration from the current TEST schema, then validate it in an isolated environment before applying it to Production.

Production remains untouched by this manifest.
