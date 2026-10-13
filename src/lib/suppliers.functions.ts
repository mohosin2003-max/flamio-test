import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Supplier records. Purchases keep storing the supplier NAME on the purchase
 * row (existing behaviour, untouched) — this list only makes the name easy to
 * pick and keeps contact details in one place.
 */

export interface SupplierRecord {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  isActive: boolean;
}

const mapRow = (row: {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  is_active: boolean;
}): SupplierRecord => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  note: row.note,
  isActive: row.is_active,
});

export const ownerListSuppliers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SupplierRecord[]> => {
    // Purchase recording needs the supplier names too.
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["suppliers", "purchases"], "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("suppliers")
      .select("id, name, phone, note, is_active")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      console.error("Supplier list failed", error);
      throw new Error("We couldn't load suppliers. Please try again.");
    }

    return (data ?? []).map(mapRow);
  });

export const ownerSaveSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        name: z.string().trim().min(2).max(80),
        phone: z.string().trim().max(40).nullable(),
        note: z.string().trim().max(400).nullable(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SupplierRecord> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "suppliers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      name: data.name,
      phone: data.phone || null,
      note: data.note || null,
      is_active: data.isActive,
    };

    const query = data.id
      ? supabaseAdmin.from("suppliers").update(payload).eq("id", data.id)
      : supabaseAdmin.from("suppliers").insert(payload);

    const { data: saved, error } = await query.select("id, name, phone, note, is_active").single();

    if (error || !saved) {
      console.error("Supplier save failed", error);
      throw new Error("We couldn't save this supplier. Please try again.");
    }

    return mapRow(saved);
  });

export const ownerDeleteSupplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "suppliers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only the supplier record is removed — purchase history keeps its own
    // copy of the supplier name and is never modified.
    const { error } = await supabaseAdmin.from("suppliers").delete().eq("id", data.id);

    if (error) {
      console.error("Supplier delete failed", error);
      throw new Error("We couldn't remove this supplier. Please try again.");
    }

    return { ok: true };
  });
