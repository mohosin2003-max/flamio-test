/**
 * Server-only escape hatch for tables that are not in the generated Supabase
 * types yet (optional, separately installed tables). Same service-role client,
 * same permissions — only the TypeScript table map is relaxed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function untypedAdmin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
