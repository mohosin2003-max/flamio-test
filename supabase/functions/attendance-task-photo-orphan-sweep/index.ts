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
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supplied = req.headers.get("x-attendance-cleanup-secret") ?? "";
  if (!supplied) return json({ error: "Unauthorized" }, 401);
  const auth = await admin.rpc("attendance_verify_task_photo_cleanup_secret", { _provided_secret: supplied });
  if (auth.error || auth.data !== true) return json({ error: "Unauthorized" }, 401);

  let body: { dryRun?: unknown };
  try { body = await req.json(); }
  catch { return json({ error: "Valid JSON body required; dryRun must be true" }, 400); }
  if (body?.dryRun !== true) return json({ error: "This deployment is dry-run-only; dryRun must be true" }, 400);

  const [orphans, expired] = await Promise.all([
    admin.rpc("attendance_list_orphan_task_photo_paths", { _limit: 500 }),
    admin.rpc("attendance_list_expired_evidence_paths", { _limit: 500 }),
  ]);
  if (orphans.error || expired.error) {
    console.error("Evidence dry-run scan failed", { orphanError: orphans.error?.message, expiredError: expired.error?.message });
    return json({ error: "Evidence scan failed" }, 500);
  }
  const orphanPaths = ((orphans.data ?? []) as ObjectPath[]).map(x => x.object_name).filter(x => typeof x === "string");
  const expiredPaths = ((expired.data ?? []) as ObjectPath[]).map(x => x.object_name).filter(x => typeof x === "string");
  const candidates = new Set([...orphanPaths, ...expiredPaths]).size;
  return json({
    dryRun: true,
    orphanCandidates: orphanPaths.length,
    expiredEvidenceCandidates: expiredPaths.length,
    candidates,
    removed: 0,
    failed: 0,
    note: "Dry-run-only deployment: no Storage objects or database references were changed."
  });
});