/**
 * The generated `types.ts` file is produced from the database schema and cannot
 * be hand-edited. This project's database lives in an external Supabase project
 * (not Lovable Cloud), so the generated types lag behind the newest notification
 * columns and tables:
 *
 *   - notifications.kind, notifications.dedupe_key
 *   - push_tokens.p256dh, push_tokens.auth, push_tokens.is_active,
 *     push_tokens.failure_count
 *   - notification_jobs (table) and claim_notification_jobs (function)
 *   - restaurant_settings notification preference columns
 *
 * `looseDb` returns the SAME admin client with schema typing relaxed, so those
 * columns can be read and written without touching the generated file. Runtime
 * behaviour, auth and RLS are unchanged — it is a compile-time escape hatch only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";

export function looseDb(client: unknown): SupabaseClient<any, "public", any> {
  return client as SupabaseClient<any, "public", any>;
}
