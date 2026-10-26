// Pure rules for Owner/Manager session review. Mirrors the DB procedure
// `attendance_verify_session` (see docs/sql/attendance_manager_self_review_fix.sql)
// so the app refuses the same requests the database refuses.
export type ReviewStatus = "verified" | "disputed" | "unverified";

export interface ReviewActor { userId: string; isOwner: boolean; isManager: boolean }
export interface ReviewSession { userId: string; clockOutAt: string | null }

export function reviewSessionError(actor: ReviewActor, session: ReviewSession, status: ReviewStatus, note?: string | null): string | null {
  if (!actor.isOwner && !actor.isManager) return "Only the Owner or a manager can review attendance.";
  if (!["verified", "disputed", "unverified"].includes(status)) return "Invalid status.";
  if (!actor.isOwner && session.userId === actor.userId) return "You cannot review your own attendance.";
  if (status === "verified" && !session.clockOutAt) return "Cannot verify an open session.";
  if (status === "disputed" && (note ?? "").trim().length < 5) return "A dispute needs a note of at least 5 characters.";
  return null;
}
