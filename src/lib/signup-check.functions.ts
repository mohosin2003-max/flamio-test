import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { normalizePhone } from "@/lib/phone";
import { callerKey, createRateLimiter } from "@/lib/rate-limit.server";

/**
 * Abuse protection for the duplicate check below: 20 checks per caller per
 * hour, keyed on the caller IP so rotating the probed phone/email cannot
 * bypass it. Best-effort per-worker memory; see rate-limit.server.ts.
 */
const duplicateCheckLimiter = createRateLimiter(20);

/**
 * Pre-signup duplicate detection. Runs server-side only and returns two
 * booleans — never account data, auth records, or provider details.
 */
export const checkSignupDuplicates = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().trim().min(6).max(30),
        email: z.string().trim().max(160).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Rate-limit before touching the database. The limited response is the
    // same "nothing found" shape, so it never reveals account details and
    // gives a probing caller no useful signal.
    if (duplicateCheckLimiter.checkAndRecord(callerKey())) {
      return { phoneExists: false, emailExists: false };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normalizePhone(data.phone);
    const email = data.email ? data.email.trim().toLowerCase() : "";

    const phoneResult = await supabaseAdmin.from("profiles").select("id").eq("phone", phone).limit(1);
    const emailResult = email
      ? await supabaseAdmin.from("profiles").select("id").eq("email", email).limit(1)
      : { data: [] as { id: string }[] };

    return {
      phoneExists: (phoneResult.data?.length ?? 0) > 0,
      emailExists: (emailResult.data?.length ?? 0) > 0,
    };
  });
