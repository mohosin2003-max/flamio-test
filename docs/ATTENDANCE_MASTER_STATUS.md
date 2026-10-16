# FLAMIO ATTENDANCE MASTER — Implementation Status

**Report date:** 2026-10-16  
**Repository:** `mohosin2003-max/flamio-test`  
**Branch inspected:** `feature/attendance-master-safe`  
**Documentation commits created during this review:** `e7c1c86bb786a026b835cf6022b7ee9f7e52f98b` (SQL review draft), `f1fd537dec8ea6db0f318979bd2ae03bc6fc80ca` (status report)  
**TEST Supabase reference supplied by project owner:** `avwrptztixaketchgmsh`  
**Production reference:** `wubsldblxvkusauafwfd` — explicitly out of scope  
**Database actions in this work:** None. No SQL executed, no migrations applied, no live data changed.

> This document is based on a read-only inspection of repository files through GitHub. No local build/test runner was available in this review, so existing test/build results are not independently reproduced here. This report does not certify the application as production-ready.

## 1. Scope and safety

- Work is limited to the Attendance feature and documentation.
- No production project access or changes were attempted.
- No SQL was executed and no schema/policy/grant changes were applied.
- No retention deletion or scheduled purge was enabled.
- No PR was merged or deployed.
- Ordering, POS, kitchen, inventory and other restaurant workflows were not intentionally edited.

## 2. Repository inspection findings

The following files were inspected on `feature/attendance-master-safe`:

- `src/components/layout/StaffBottomNav.tsx`
- `src/routes/_authenticated/owner.tsx`
- `src/routes/_authenticated/owner.attendance.tsx`
- `src/lib/attendance.functions.ts`
- `src/lib/permissions.ts`
- `src/lib/push.server.ts`
- `package.json`

### Navigation

- `StaffBottomNav.tsx` currently defines four items: Home, Messages, Orders, Account.
- It does not currently define a My Duty item or an `attendance` permission check for that item.
- The owner shell's `TABS` currently contains older Attendance-related entries gated by `staff` and `ownerRoleOnly`, rather than the requested `attendance` and `attendance_management` entries.
- The shell returns the access-restricted UI unless `access.data.isOwner` is true. Therefore, simply adding a manager permission tab would not by itself make the route usable by managers; the shell's existing authorization behavior needs a carefully scoped review before any change.

### Existing Owner Attendance route

- `src/routes/_authenticated/owner.attendance.tsx` already exists.
- It calls `ownerGetAttendanceOverview` and `ownerUpdateAttendanceSettings`.
- The current page is a basic recent-session/task overview plus settings form; it is not the requested six-tab management dashboard.
- The route's current query refreshes every 60 seconds, not every 30 seconds.
- The component contains an early-return path before a later `useEffect` call. This may violate React's Rules of Hooks when query state changes; move hooks above conditional returns and verify with lint/runtime tests before relying on this page.

### Attendance server functions

- The inspected `src/lib/attendance.functions.ts` contains `ownerGetAttendanceOverview`, which checks `access.isOwner` and reads settings, recent sessions and tasks.
- This inspected file does not expose the complete set of self-service and manager functions described in the audit text. Other files may contain related functions, but they must be located and their actual signatures verified before integrating them.
- The inspected overview uses an admin database client after checking owner access. Any expansion must preserve server-side role checks and avoid exposing unrelated personal data.

### Permissions

- `attendance` and `attendance_management` are present in `STAFF_PERMISSIONS`, with labels and hints.
- Their presence in the catalogue does not grant them to staff automatically. Permission grants must be explicitly configured by the existing permission-management workflow.

### Push infrastructure

- `src/lib/push.server.ts` has existing Web Push delivery, in-app notification creation, deduplication support through notification dedupe keys, and delivery outcome tracking.
- Attendance-specific event dispatch was not found in the inspected server file. Before integration, verify notification kinds/schema constraints, recipient selection, event call sites, and the existing delivery semantics.
- A Web Push tag alone is not a server-side idempotency guarantee. Use stable dedupe keys and avoid blocking attendance database mutations on push delivery.

## 3. Review-only SQL draft

Created: `docs/sql/attendance_review_draft_v2.sql`

The draft covers:
- A proposed owner-only attendance settings policy, conditional on exact schema/policy verification.
- A warning and dependency checks before changing `has_role` EXECUTE grants.
- Optional station latitude/longitude/geofence-radius columns and range constraints.
- A QR challenge table proposal with hashed token storage, expiry, and consumption fields.
- A proposed non-destructive retention preview with owner authorization and bounded day range.
- Read-only validation queries and a rollback template.

**The SQL file is review-only and all executable SQL is commented out. It has not been run.** The rollback section is a template: an actual rollback must restore verified prior definitions and must not discard data created after a migration.

## 4. Verification status

| Check | Status | Evidence / limitation |
|---|---|---|
| GitHub file inspection | Completed | Files listed in section 2 fetched from the target branch |
| `tsgo` / typecheck | Not run in this review | Requires project build environment |
| `bun test` | Not run in this review | Previously reported 11/11 passing by project workflow, not independently reproduced here |
| ESLint | Not run in this review | Must run in the working project |
| `vite build` | Not run in this review | A prior pass was reported, but not reproduced in this review |
| Running-app verification | Not run | Requires authenticated TEST accounts and an app runtime |
| TEST database mutation | None | No SQL executed; no data/schema/policies changed |
| Production mutation | None | Production is out of scope |

## 5. Changes made in this review

- Added `docs/sql/attendance_review_draft_v2.sql` as a commented, review-only proposal. It has not been executed.
- Added this status report at `docs/ATTENDANCE_MASTER_STATUS.md`.
- Added permission-gated “My duty” navigation to `src/components/layout/StaffBottomNav.tsx`, linking to the verified route `/attendance` (not the non-existent `/owner/duty`).
- Updated Attendance-related Owner shell tab permissions in `src/routes/_authenticated/owner.tsx` to use `attendance_management`. The routes retain the existing owner-only guard because the underlying server functions are owner-only; manager access is not claimed.
- Fixed the conditional React hook ordering in `src/routes/_authenticated/owner.attendance.tsx` by moving the settings effect before early returns.
- Changed the owner overview refresh to 30 seconds and added navigation links to the existing Stations & Shifts and Tasks & Requests workspaces.
- Added `src/lib/attendance-push.server.ts` with best-effort late-arrival, pending-request, and request-decision notifications using the existing push infrastructure and stable dedupe keys.
- Wired best-effort alerts after successful clock-in/request creation/request review in `src/lib/attendance-workflow.functions.ts`. Request review now checks that its conditional update returned a row, to avoid reporting a duplicate review as successful.
- No database schema or application data was changed. No application build/test command could be run from the GitHub file-editing environment.

## 6. Outstanding work

1. The staff page is currently `/attendance`; it is linked from the bottom navigation. The earlier requested `/owner/duty` route does not exist in the inspected branch.
2. The Owner Attendance page is still a summary/settings page with links to existing Stations & Shifts and Tasks & Requests routes; it is not yet a single six-tab dashboard. The existing management/workflow routes are owner-only in their server functions.
3. Verify notification table constraints and delivery behavior in CI/runtime. Push dispatch is best-effort; it is not proof of delivery, and background audio cannot be guaranteed.
4. Validate request approval against authenticated TEST staff/owner accounts. The current request-review function updates request status; this review did not establish that correction/missed-punch approval atomically updates session/break records.
5. Run typecheck, lint, tests, and production build in the project workspace and attach exact outputs.
6. Perform role-based end-to-end checks: staff self-only data access, owner-only settings, duplicate approval prevention, GPS stale/accuracy handling, and push behavior.
7. Keep the pull request Draft and unmerged until the owner explicitly authorizes further release steps.

## 7. Release assessment

**Not production-ready.** Navigation and best-effort push hooks have been added, and the existing schedule/task/request routes are linked from the overview. Runtime behavior, approval-trigger reconciliation, notification delivery, role-based end-to-end access, and all build checks remain unverified. No destructive retention workflow should be enabled.
