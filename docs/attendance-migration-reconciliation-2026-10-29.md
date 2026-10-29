# FLAMIO ATTENDANCE MASTER — TEST migration reconciliation (2026-10-29)

Target repository: `mohosin2003-max/flamio-test`
Target Supabase TEST project: `avwrptztixaketchgmsh`
Production is strictly out of scope.

## Scope and safety

This reconciliation compares the migration ledger exposed by Supabase with SQL sources in GitHub. It does not apply migrations, alter `supabase_migrations.schema_migrations`, delete attendance records, remove Storage objects, or deploy Edge Functions.

The TEST migration ledger returned 21 records. The repository had 40 migration SQL files before this recovery work. Ten applied TEST migration records had no same-version source file: four retention migrations, two retention hardening/retry migrations, feature toggles, selfie evidence, private bucket, and Owner alerts. Ten source files have been restored or reconstructed under the TEST ledger version prefixes. Their source files have now been restored under the exact TEST ledger version prefixes.

**Recovery limitation:** some recovered SQL files are idempotent source reconstructions from the current TEST database and checked-in documentation, not byte-for-byte copies of the original SQL that was executed. Do not treat a source reconstruction as proof of the exact historical migration body. No reconstructed migration was applied to any database.

## TEST ledger-to-source map

| TEST ledger version | TEST ledger name | Source file / disposition |
|---|---|---|
| 20261016074823 | attendance_security_verification_extension_20261016 | `20261016074823_attendance_security_verification_extension_20261016.sql` — version/name drift; semantic source match |
| 20261016075244 | attendance_helper_acl_hardening_20261016 | `20261016075244_attendance_helper_acl_hardening_20261016.sql` — version/name drift; semantic source match |
| 20261016080435 | attendance_qr_station_binding_20261016 | `20261016080435_attendance_qr_station_binding_20261016.sql` — version/name drift; semantic source match |
| 20261016081103 | attendance_request_review_service_bridge_20261016 | `20261016081103_attendance_request_review_service_bridge_20261016.sql` — version/name drift; semantic source match |
| 20261016134805 | create_staff_permissions_and_owner_invites | Related schema source is present across the legacy baseline files `20260914214536_63e4cfc8-3207-45ed-9bad-722002357bd8.sql` and `20260915033358_6ed0d102-d855-42f3-bf5a-1f50f2f58b2e.sql`; the original combined ledger body was not recovered byte-for-byte |
| 20261016153910 | attendance_rpc_acl_hardening | `20261016153910_attendance_rpc_acl_hardening.sql` — version drift; name/source match |
| 20261017170155 | attendance_stale_session_recovery | `20261017170155_attendance_stale_session_recovery.sql` |
| 20261019191216 | attendance_feature_toggles | `20261019191216_attendance_feature_toggles.sql` — recovered from checked-in docs and TEST schema |
| 20261020075908 | attendance_selfie_evidence | `20261020075908_attendance_selfie_evidence.sql` — recovered from checked-in docs and TEST schema |
| 20261020080029 | create_private_attendance_evidence_bucket | `20261020080029_create_private_attendance_evidence_bucket.sql` — recovered from verified TEST bucket settings |
| 20261023173648 | attendance_phase_b_task_photo_atomic_completion | `20261023173648_attendance_phase_b_task_photo_atomic_completion.sql` |
| 20261023174220 | attendance_phase_b_photo_freshness_guard | `20261023174220_attendance_phase_b_photo_freshness_guard.sql` |
| 20261023180554 | attendance_task_photo_orphan_sweep | `20261023180554_attendance_task_photo_orphan_sweep.sql` — version drift; name/source match |
| 20261028043142 | attendance_location_report | `20261028043142_attendance_location_report.sql` — version drift; name/source match |
| 20261028153511 | attendance_owner_alert_notifications | `20261028153511_attendance_owner_alert_notifications.sql` — reconstructed from verified TEST setting column |
| 20261028193223 | attendance_evidence_retention_helpers_20261029 | `20261028193223_attendance_evidence_retention_helpers_20261029.sql` — reconstructed from current TEST function definitions |
| 20261028193237 | attendance_90_day_record_retention_20261029 | `20261028193237_attendance_90_day_record_retention_20261029.sql` — staged reconstruction |
| 20261028193321 | attendance_retention_stable_age_basis_20261029 | `20261028193321_attendance_retention_stable_age_basis_20261029.sql` — staged reconstruction |
| 20261028195142 | attendance_retention_preserve_unverified_20261029 | `20261028195142_attendance_retention_preserve_unverified_20261029.sql` — staged reconstruction |
| 20261029130039 | harden_attendance_expired_evidence_ref_paths | `20261029130039_harden_attendance_expired_evidence_ref_paths.sql` — reconstructed from current TEST function definition and ACL |
| 20261029130242 | retry_missing_attendance_evidence_objects | `20261029130242_retry_missing_attendance_evidence_objects.sql` — reconstructed from current TEST function definition and ACL |

## Verified TEST state (read-only)

- `attendance-evidence` bucket exists and is private, with 1,500,000-byte limit and `image/jpeg` allowlist.
- `attendance_settings` contains `attendance_enabled`, `tasks_enabled`, `selfie_verification_enabled`, `qr_verification_enabled`, `geofence_enabled`, and `attendance_alerts_enabled`.
- `attendance_clear_expired_evidence_refs(text[])`, `attendance_list_expired_evidence_paths(integer)`, and `attendance_purge_old_records()` are owned by `postgres`, are SECURITY DEFINER, set an empty search_path, and grant EXECUTE only to `postgres` and `service_role` in the observed ACL.
- `attendance_purge_old_records()` protects open, auto-closed, disputed, and unverified sessions and uses a 90-day cutoff. Completed tasks use `coalesce(completed_at, created_at)`.
- The expiry-path functions validate expected object paths and are restricted to service_role.

## Remaining historical limitation

The eight historical filename/version mismatches were aligned to the exact TEST ledger prefixes in this TEST-only repository. For `20261016134805_create_staff_permissions_and_owner_invites.sql`, a documented no-op compatibility marker is used because the clean-room baseline sources already create those objects; the original combined historical SQL was not recovered byte-for-byte. Do not apply reconstructed sources to Production. No database migration history was edited.

The source-to-ledger audit now has a filename for every one of the 21 TEST ledger versions. This aligns the TEST repository's migration versions without altering the TEST database. The distinction between exact checked-in source, recovered source snapshot, and no-op compatibility marker remains explicit. For a future clean-room database build, validate the sequence in a disposable TEST project before use; never apply reconstructed sources blindly to Production.
