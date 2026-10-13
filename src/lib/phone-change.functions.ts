import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidPhone, normalizePhone, phoneToAuthEmail } from "@/lib/phone";

/**
 * Called after the authentication provider has verified a real SMS OTP for the
 * new phone number. Keeps the derived login email in sync with the new phone
 * so phone + password sign-in keeps working, and stores the new number on the
 * customer profile.
 */
export const commitPhoneChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ phone: z.string().min(3) }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message?: string }> => {
    if (!isValidPhone(data.phone)) {
      return { ok: false, message: "Please enter a valid phone number." };
    }
    const phone = normalizePhone(data.phone);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      email: phoneToAuthEmail(phone),
      email_confirm: true,
    });
    if (authError) {
      console.error("Updating login identity failed", authError);
      return {
        ok: false,
        message: /already|registered|exists/i.test(authError.message)
          ? "That phone number is already used by another account."
          : "We couldn't update your login phone number. Please try again.",
      };
    }

    const { error: profileError } = await context.supabase
      .from("profiles")
      .update({ phone })
      .eq("id", context.userId);

    if (profileError) {
      console.error("Updating profile phone failed", profileError);
      return { ok: false, message: "We couldn't save your new phone number. Please try again." };
    }

    return { ok: true };
  });
