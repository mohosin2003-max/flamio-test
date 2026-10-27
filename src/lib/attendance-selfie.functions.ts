import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";
import {
  SELFIE_BUCKET, SELFIE_MAX_BYTES, SELFIE_SIGNED_URL_SECONDS, buildSelfiePath, decodeBase64, validateSelfieBytes, validateSelfieCaptureTime,
} from "@/lib/attendance-selfie";

/**
 * Staff uploads a fresh camera JPEG. The bytes travel to the server only to
 * be written to private Storage; nothing image-like is stored in Postgres.
 * The storage path is built here from the authenticated user id.
 */
export const staffUploadAttendanceSelfie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    imageBase64: z.string().min(100).max(Math.ceil((SELFIE_MAX_BYTES * 4) / 3) + 8).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    capturedAt: z.number().int().positive(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can submit check-in photos.");
    let bytes: Uint8Array;
    try { bytes = decodeBase64(data.imageBase64); } catch { throw new Error("The photo could not be read. Retake it."); }
    const valid = validateSelfieBytes(bytes);
    if (!valid.ok) throw new Error(valid.reason);
    const nowMs = Date.now();
    const captureTime = validateSelfieCaptureTime(data.capturedAt, nowMs);
    if (!captureTime.ok) throw new Error(captureTime.reason);
    const capturedAt = new Date(data.capturedAt);
    const path = buildSelfiePath(context.userId, capturedAt, crypto.randomUUID());
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { error } = await db.storage.from(SELFIE_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("Attendance selfie upload failed", error.message);
      throw new Error("Check-in photo upload failed. Check your connection and retry.");
    }
    return { path, capturedAt: capturedAt.toISOString() };
  });

/** Owner/Manager only: short-lived link to a session's clock-in selfie. */
export const ownerGetAttendanceSelfieUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner && !access.isManager) throw new Error("Only the Owner or a manager can view attendance evidence.");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: row, error } = await db.from("attendance_sessions").select("id, user_id, clock_in_selfie_path").eq("id", data.sessionId).maybeSingle();
    if (error) {
      if (/clock_in_selfie_path/.test(error.message)) return { url: null, reason: "Selfie evidence storage is not set up yet." };
      throw new Error("Could not load this check-in session.");
    }
    if (!row) throw new Error("Session not found.");
    if (!row.clock_in_selfie_path) return { url: null, reason: "No photo was recorded for this check-in." };
    if (!String(row.clock_in_selfie_path).startsWith(`${row.user_id}/`)) return { url: null, reason: "Evidence path does not match this staff member." };
    const { data: signed, error: signError } = await db.storage.from(SELFIE_BUCKET).createSignedUrl(row.clock_in_selfie_path, SELFIE_SIGNED_URL_SECONDS);
    if (signError || !signed?.signedUrl) return { url: null, reason: "The selfie file is no longer available." };
    await db.from("attendance_audit_log").insert({
      table_name: "attendance_sessions", row_id: row.id, action: "UPDATE", actor_id: context.userId, subject_user_id: row.user_id,
      new_data: { _attendance_event: "selfie_evidence_viewed" },
    });
    return { url: signed.signedUrl as string, reason: null };
  });

/**
 * Owner only: DRY-RUN orphan selfie scan. Lists files and reports candidates.
 * Read-only — this function never removes or modifies any storage object.
 */
export const ownerScanOrphanSelfies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can run the orphan selfie scan.");
    const { classifyOrphanSelfies } = await import("@/lib/attendance-selfie-scan");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const bucket = db.storage.from(SELFIE_BUCKET);
    const MAX_FILES = 5000;
    const files: { path: string; createdAt: string | null }[] = [];
    let truncated = false;
    const { data: users, error: e1 } = await bucket.list("", { limit: 1000 });
    if (e1) throw new Error("Could not list evidence storage.");
    outer: for (const u of users ?? []) {
      if (u.id) continue; // folders have no id
      const { data: days } = await bucket.list(u.name, { limit: 1000 });
      for (const d of days ?? []) {
        if (d.id || !/^\d{4}-\d{2}-\d{2}$/.test(d.name)) continue; // skips tasks/ and stray files
        const { data: items } = await bucket.list(`${u.name}/${d.name}`, { limit: 1000 });
        for (const f of items ?? []) {
          if (!f.id) continue;
          files.push({ path: `${u.name}/${d.name}/${f.name}`, createdAt: f.created_at ?? null });
          if (files.length >= MAX_FILES) { truncated = true; break outer; }
        }
      }
    }
    const { data: refs, error: e2 } = await db.from("attendance_sessions").select("clock_in_selfie_path").not("clock_in_selfie_path", "is", null);
    if (e2) throw new Error("Could not read attendance references.");
    const result = classifyOrphanSelfies(files, (refs ?? []).map((r: { clock_in_selfie_path: string }) => r.clock_in_selfie_path), Date.now());
    return { ...result, truncated, candidates: result.candidates.slice(0, 200) };
  });
