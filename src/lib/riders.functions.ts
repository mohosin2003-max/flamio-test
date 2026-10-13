import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Delivery riders. Assignment reuses the EXISTING orders table (new optional
 * rider_id column) — order status, delivery charge and zone logic are
 * untouched.
 */

export interface RiderRecord {
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
}): RiderRecord => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  note: row.note,
  isActive: row.is_active,
});

export const ownerListRiders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RiderRecord[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "riders", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("riders")
      .select("id, name, phone, note, is_active")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      console.error("Rider list failed", error);
      throw new Error("We couldn't load riders. Please try again.");
    }

    return (data ?? []).map(mapRow);
  });

export const ownerSaveRider = createServerFn({ method: "POST" })
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
  .handler(async ({ data, context }): Promise<RiderRecord> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "riders");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      name: data.name,
      phone: data.phone || null,
      note: data.note || null,
      is_active: data.isActive,
    };

    const query = data.id
      ? supabaseAdmin.from("riders").update(payload).eq("id", data.id)
      : supabaseAdmin.from("riders").insert(payload);

    const { data: saved, error } = await query.select("id, name, phone, note, is_active").single();

    if (error || !saved) {
      console.error("Rider save failed", error);
      throw new Error("We couldn't save this rider. Please try again.");
    }

    return mapRow(saved);
  });

export const ownerDeleteRider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "riders");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only the rider record is removed. Orders keep every other field; their
    // rider link simply clears (ON DELETE SET NULL).
    const { error } = await supabaseAdmin.from("riders").delete().eq("id", data.id);

    if (error) {
      console.error("Rider delete failed", error);
      throw new Error("We couldn't remove this rider. Please try again.");
    }

    return { ok: true };
  });

/** Assigns (or clears) a rider on an existing order. Nothing else changes. */
export const ownerAssignRider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        riderId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "riders");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("orders")
      .update({ rider_id: data.riderId })
      .eq("id", data.orderId);

    if (error) {
      console.error("Rider assignment failed", error);
      throw new Error("We couldn't assign this rider. Please try again.");
    }

    return { ok: true, riderId: data.riderId };
  });
