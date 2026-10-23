/** Pure validation for private attendance task-photo evidence. */
export const TASK_PHOTO_BUCKET = "attendance-evidence";
export const TASK_PHOTO_MAX_BYTES = 1_500_000;
export const TASK_PHOTO_MIN_BYTES = 2_000;
export const TASK_PHOTO_SIGNED_URL_SECONDS = 600;
export const TASK_PHOTO_MAX_AGE_MS = 15 * 60 * 1000;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function buildTaskPhotoPath(userId: string, taskId: string, at: Date, photoId: string): string {
  if (!new RegExp(`^${UUID}$`, "i").test(userId) || !new RegExp(`^${UUID}$`, "i").test(taskId) || !new RegExp(`^${UUID}$`, "i").test(photoId)) {
    throw new Error("Invalid task photo path parts.");
  }
  return `${userId.toLowerCase()}/tasks/${taskId.toLowerCase()}/${at.getTime()}-${photoId.toLowerCase()}.jpg`;
}

export type TaskPhotoPathCheck = { ok: true; uploadedAtMs: number } | { ok: false; reason: string };
export function checkTaskPhotoPath(path: unknown, userId: string, taskId: string, now: number): TaskPhotoPathCheck {
  if (typeof path !== "string" || path.length > 220) return { ok: false, reason: "Photo proof is missing or invalid." };
  const m = new RegExp(`^(${UUID})/tasks/(${UUID})/(\\d{13})-(${UUID})\\.jpg$`).exec(path);
  if (!m) return { ok: false, reason: "Photo proof path format is invalid." };
  if (m[1] !== userId.toLowerCase()) return { ok: false, reason: "Photo proof does not belong to your account." };
  if (m[2] !== taskId.toLowerCase()) return { ok: false, reason: "Photo proof does not belong to this task." };
  const uploadedAtMs = Number(m[3]);
  if (!Number.isSafeInteger(uploadedAtMs) || uploadedAtMs > now + 60_000) return { ok: false, reason: "Photo timestamp is invalid." };
  if (now - uploadedAtMs > TASK_PHOTO_MAX_AGE_MS) return { ok: false, reason: "Photo upload has expired (15 min limit). Please retake or re-upload." };
  return { ok: true, uploadedAtMs };
}

export function validateTaskPhotoBytes(bytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (bytes.length < TASK_PHOTO_MIN_BYTES) return { ok: false, reason: "The photo is empty or too small. Retake it." };
  if (bytes.length > TASK_PHOTO_MAX_BYTES) return { ok: false, reason: "The photo is too large. Retake it." };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { ok: false, reason: "Only JPEG photos are accepted." };
  return { ok: true };
}

export function canCompleteTask(task: { id: string; status: string; requires_photo: boolean }, checklistItems: Array<{ is_done: boolean }>, photoPath: unknown, userId: string, now: number): { ok: true } | { ok: false; reason: string } {
  if (!["pending", "in_progress", "rejected"].includes(task.status)) return { ok: false, reason: "This task is already closed." };
  if (checklistItems.some((item) => item.is_done !== true)) return { ok: false, reason: "All checklist items must be ticked before marking this task complete." };
  if (task.requires_photo) {
    const checked = checkTaskPhotoPath(photoPath, userId, task.id, now);
    if (!checked.ok) return { ok: false, reason: checked.reason };
  }
  return { ok: true };
}
