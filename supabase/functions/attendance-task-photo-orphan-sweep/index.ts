import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createEvidenceSweepHandler } from "./handler.ts";
import { runEvidenceSweep } from "./sweep.ts";
type ObjectPath = { object_name: string };
const url = Deno.env.get("SUPABASE_URL");
const keysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
if (!url || !keysRaw) throw new Error("Missing Supabase environment.");
const keys = JSON.parse(keysRaw) as Record<string, string>;
const key = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!key) throw new Error("Missing service key.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createEvidenceSweepHandler({
  async authorize(secret) {
    const auth = await admin.rpc("attendance_verify_task_photo_cleanup_secret", { _provided_secret: secret });
    if (auth.error) console.error("Cleanup authorization RPC failed", auth.error.message);
    return !auth.error && auth.data === true;
  },
  async listCandidates() {
    const [orphans, expired] = await Promise.all([
      admin.rpc("attendance_list_orphan_task_photo_paths", { _limit: 500 }),
      admin.rpc("attendance_list_expired_evidence_paths", { _limit: 500 }),
    ]);
    if (orphans.error || expired.error) throw new Error(`orphanError=${orphans.error?.message ?? "none"}; expiredError=${expired.error?.message ?? "none"}`);
    return {
      orphanPaths: ((orphans.data ?? []) as ObjectPath[]).map((x) => x.object_name).filter((x) => typeof x === "string"),
      expiredPaths: ((expired.data ?? []) as ObjectPath[]).map((x) => x.object_name).filter((x) => typeof x === "string"),
    };
  },
  async sweep(orphanPaths, expiredPaths) {
    return await runEvidenceSweep(orphanPaths, expiredPaths, {
      async removeFiles(batch) {
        const res = await admin.storage.from("attendance-evidence").remove(batch);
        if (res.error) console.error("Storage removal failed", res.error.message);
        return { error: res.error?.message ?? null };
      },
      async clearExpiredRefs(batch) {
        const res = await admin.rpc("attendance_clear_expired_evidence_refs", { _paths: batch });
        if (res.error) console.error("Clearing expired evidence references failed", res.error.message);
        return { error: res.error?.message ?? null };
      },
    });
  },
}));
