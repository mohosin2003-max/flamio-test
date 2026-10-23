import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type OrphanPath = { object_name: string };

const projectUrl = Deno.env.get("SUPABASE_URL");
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
if (!projectUrl || !secretKeysRaw) throw new Error("Supabase Edge Function environment is incomplete.");
const secretKeys = JSON.parse(secretKeysRaw) as Record<string, string>;
const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!serviceKey) throw new Error("Supabase service key is unavailable.");
const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const providedSecret = req.headers.get("x-attendance-cleanup-secret") ?? "";
  if (!providedSecret) return json({ error: "Unauthorized" }, 401);
  const { data: valid, error: verifyError } = await admin.rpc("attendance_verify_task_photo_cleanup_secret", {
    _provided_secret: providedSecret,
  });
  if (verifyError || valid !== true) return json({ error: "Unauthorized" }, 401);

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // An empty cron request body is treated as a normal scheduled run.
  }

  const { data, error } = await admin.rpc("attendance_list_orphan_task_photo_paths", { _limit: 500 });
  if (error) {
    console.error("Task photo orphan scan failed", error.message);
    return json({ error: "Orphan scan failed" }, 500);
  }
  const paths = ((data ?? []) as OrphanPath[]).map((row) => row.object_name).filter((path) => typeof path === "string");
  if (dryRun || paths.length === 0) {
    console.info("Task photo orphan sweep preview", { candidates: paths.length, dryRun });
    return json({ dryRun, candidates: paths.length, removed: 0, failed: 0 }, 200);
  }

  let removed = 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error: removeError } = await admin.storage.from("attendance-evidence").remove(batch);
    if (removeError) {
      failed += batch.length;
      console.error("Task photo orphan removal failed", { count: batch.length, message: removeError.message });
    } else {
      removed += batch.length;
    }
  }

  console.info("Task photo orphan sweep completed", { candidates: paths.length, removed, failed });
  return json({ dryRun: false, candidates: paths.length, removed, failed }, failed ? 207 : 200);
});

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
