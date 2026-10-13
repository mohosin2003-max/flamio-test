import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";

import type { Database } from "@/integrations/supabase/types";

/**
 * Best-effort caller identity for endpoints that must serve BOTH guests and
 * signed-in customers (e.g. placing an order). Returns null when the request
 * carries no valid bearer token — it never throws.
 */
export async function getOptionalUserId(): Promise<string | null> {
  try {
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

    const token = authHeader.slice("Bearer ".length).trim();
    if (token.split(".").length !== 3) return null;

    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return null;

    const client = createClient<Database>(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("apikey", key);
          headers.set("Authorization", `Bearer ${token}`);
          return fetch(input, { ...init, headers });
        },
      },
    });

    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return String(data.claims.sub);
  } catch {
    return null;
  }
}
