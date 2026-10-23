import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";
import { decodeBase64 } from "@/lib/attendance-selfie";
import {
  TASK_PHOTO_BUCKET, TASK_PHOTO_MAX_BYTES, TASK_PHOTO_MIN_BYTES,
  TASK_PHOTO_SIGNED_URL_SECONDS, buildTaskPhotoPath, validateTaskPhotoBytes,
} from "@/lib/attendance-task-photo";

const imageInput = z.object({
  taskId: z.string().uuid(),
  imageBase64: z.string().min(100).max(Math.ceil((TASK_PHOTO_MAX_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

/** Server validates bytes and builds the path; clients never upload directly to Storage. */
export const staffUploadAttendanceTaskPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => imageInput.parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can upload task photo proof.");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: task, error: taskError } = await db.from("attendance_tasks")
      .select("id, assigned_to, status")
      .eq("id", data.taskId).eq("assigned_to", context.userId).maybeSingle();
    if (taskError || !task) throw new Error("Task not found.");
    if (!["pending", "in_progress", "rejected"].includes(task.status)) throw new Error("This task is already closed.");

    let bytes: Uint8Array;
    try { bytes = decodeBase64(data.imageBase64); } catch { throw new Error("The photo could not be read. Retake it."); }
    const valid = validateTaskPhotoBytes(bytes);
    if (!valid.ok) throw new Error(valid.reason);
    if (bytes.byteLength < TASK_PHOTO_MIN_BYTES || bytes.byteLength > TASK_PHOTO_MAX_BYTES) {
      throw new Error("Photo size is outside the allowed limit.");
    }

    const now = new Date();
    const path = buildTaskPhotoPath(context.userId, task.id, now, crypto.randomUUID());
    const { error: uploadError } = await db.storage.from(TASK_PHOTO_BUCKET)
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (uploadError) {
      console.error("Attendance task photo upload failed", uploadError.message);
      throw new Error("Photo upload failed. Check your connection and retry.");
    }
    return { path, uploadedAt: now.toISOString() };
  });

/** Owner/Manager only: short-lived URL for task proof. */
export const ownerGetAttendanceTaskPhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner && !access.isManager) throw new Error("Only the Owner or a manager can view task photo proof.");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: task, error } = await db.from("attendance_tasks")
      .select("id, assigned_to, photo_path")
      .eq("id", data.taskId).maybeSingle();
    if (error || !task) throw new Error("Task not found.");
    if (!task.photo_path) return { url: null, reason: "No photo proof was submitted." };
    const pattern = new RegExp(`^(${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"})/tasks/(${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"})/(\\d{13})-(${"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"})\\.jpg$`);
    const match = pattern.exec(task.photo_path);
    if (!match || match[1] !== String(task.assigned_to).toLowerCase() || match[2] !== String(task.id).toLowerCase()) {
      throw new Error("Task photo path does not match the assigned staff member and task.");
    }
    const { data: signed, error: signError } = await db.storage.from(TASK_PHOTO_BUCKET)
      .createSignedUrl(task.photo_path, TASK_PHOTO_SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) return { url: null, reason: "The photo proof is no longer available." };
    const { error: auditError } = await db.from("attendance_audit_log").insert({
      table_name: "attendance_tasks", row_id: task.id, action: "UPDATE", actor_id: context.userId,
      subject_user_id: task.assigned_to,
      new_data: { _attendance_event: "task_photo_viewed", viewed_at: new Date().toISOString() },
    });
    if (auditError) console.error("Task photo view audit failed", auditError.message);
    return { url: signed.signedUrl as string, reason: null };
  });
