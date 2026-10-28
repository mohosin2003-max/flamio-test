import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ObjectPath = { object_name: string };
const url = Deno.env.get("SUPABASE_URL");
const keysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
if (!url || !keysRaw) throw new Error("Missing Supabase environment.");
const keys = JSON.parse(keysRaw) as Record<string, string>;
const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!key) throw new Error("Missing service key.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supplied = req.headers.get("x-attendance-cleanup-secret") ?? "";
  if (!supplied) return json({ error: "Unauthorized" }, 401);
  const auth = await admin.rpc("attendance_verify_task_photo_cleanup_secret", { _provided_secret: supplied });
  if (auth.error || auth.data !== true) return json({ error: "Unauthorized" }, 401);

  let dryRun = false;
  try { dryRun = (await req.json())?.dryRun === true; } catch { /* scheduled request may have empty body */ }

  const [orphans, expired] = await Promise.all([
    admin.rpc("attendance_list_orphan_task_photo_paths", { _limit: 500 }),
    admin.rpc("attendance_list_expired_evidence_paths", { _limit: 500 }),
  ]);
  if (orphans.error || expired.error) {
    console.error("Evidence scan failed", { orphanError: orphans.error?.message, expiredError: expired.error?.message });
    return json({ error: "Evidence scan failed" }, 500);
  }
  const orphanPaths = ((orphans.data ?? []) as ObjectPath[]).map(x => x.object_name).filter(x => typeof x === "string");
  const expiredPaths = ((expired.data ?? []) as ObjectPath[]).map(x => x.object_name).filter(x => typeof x === "string");
  const paths = [...new Set([...orphanPaths, ...expiredPaths])];
  if (dryRun || paths.length === 0) return json({ dryRun, orphanCandidates: orphanPaths.length, expiredEvidenceCandidates: expiredPaths.length, candidates: paths.length, removed: 0, failed: 0 }, 200);

  if (expiredPaths.length) {
    const cleared = await admin.rpc("attendance_clear_expired_evidence_refs", { _paths: [...new Set(expiredPaths)] });
    if (cleared.error) return json({ error: "Could not clear expired evidence references" }, 500);
  }
  let removed = 0, failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const result = await admin.storage.from("attendance-evidence").remove(batch);
    if (result.error) { failed += batch.length; console.error("Storage removal failed", result.error.message); }
    else removed += batch.length;
  }
  return json({ dryRun: false, orphanCandidates: orphanPaths.length, expiredEvidenceCandidates: expiredPaths.length, candidates: paths.length, removed, failed }, failed ? 207 : 200);
});

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}