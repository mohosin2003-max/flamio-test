# FLAMIO ATTENDANCE MASTER — Production Release Package

## Safety
- TEST reference: avwrptztixaketchgmsh
- Production database: psckjmopvxaqvroaltfu
- This package does NOT modify Production.
- Do not apply individual hardening migrations to Production in isolation.

## Verified TEST release state
- Attendance settings singleton: enforced.
- Attendance/tasks fail-closed while disabled.
- User-owned attendance FKs hardened to ON DELETE RESTRICT.
- Evidence bucket private, JPEG-only, 1.5 MB.
- Evidence own-folder INSERT/SELECT policies present.
- Sensitive attendance RPC execution ACLs hardened.
- Latest TEST migrations recorded:
  - 20261123143025 / 20261123_attendance_incremental_hardening
  - 20261123144656 / 20261123_attendance_singleton_final

## Production migration order
Production currently has no public attendance_* tables. Therefore the release must start from the Attendance Master base schema and then apply the dependency-ordered attendance migrations, followed by the final hardening migrations.

Do NOT copy only:
- 20261123_attendance_incremental_hardening
- 20261123_attendance_singleton_final

Those are incremental hardening steps and assume the Attendance Master schema already exists.

## Important release blockers
Several historical TEST migrations are reconstructed snapshots rather than guaranteed byte-for-byte originals. Examples include:
- attendance_feature_toggles
- attendance_selfie_evidence
- attendance_owner_alert_notifications
- attendance_evidence_retention_helpers

These must be reconciled against the current TEST schema/function definitions before Production deployment.

## Required final release gate
1. Build a clean-room Production migration from the verified TEST schema.
2. Preflight every referenced table, enum, function, trigger, policy, index, storage bucket and cron dependency.
3. Run the complete migration on an isolated disposable database/branch.
4. Run attendance regression tests.
5. Only after PASS, obtain explicit approval to touch Production.
6. Apply the release migration to Production.
7. Verify Production schema, ACLs, RLS, storage and cron.
8. Keep attendance feature toggles OFF until live Android smoke test passes.

## Current decision
Production deployment is intentionally NOT executed by this package.
