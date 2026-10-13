import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Coupons. Codes are never validated in the browser: `checkCoupon` and the
 * order placement path both recompute the discount server-side from the
 * `coupons` table, so a customer cannot invent a discount.
 */

export interface CouponRecord {
  id: string;
  code: string;
  description: string | null;
  discountType: "percent" | "fixed";
  discountValue: number;
  minOrderTotal: number;
  maxDiscount: number | null;
  startsOn: string | null;
  expiresOn: string | null;
  usageLimit: number | null;
  timesUsed: number;
  isActive: boolean;
}

type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number | string;
  min_order_total: number | string;
  max_discount: number | string | null;
  starts_on: string | null;
  expires_on: string | null;
  usage_limit: number | null;
  times_used: number;
  is_active: boolean;
};

const COLUMNS =
  "id, code, description, discount_type, discount_value, min_order_total, max_discount, starts_on, expires_on, usage_limit, times_used, is_active";

function toRecord(row: CouponRow): CouponRecord {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    // DB stores "amount" for fixed-amount coupons (constraint allows only
    // "percent"/"amount"); legacy "fixed" rows are still treated as fixed.
    discountType:
      row.discount_type === "amount" || row.discount_type === "fixed" ? "fixed" : "percent",
    discountValue: Number(row.discount_value),
    minOrderTotal: Number(row.min_order_total),
    maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
    startsOn: row.starts_on,
    expiresOn: row.expires_on,
    usageLimit: row.usage_limit,
    timesUsed: row.times_used,
    isActive: row.is_active,
  };
}

/**
 * Server-side discount calculation shared by `checkCoupon` and `placeOrder`.
 * Returns `null` when the code cannot be used for this subtotal.
 */
export function couponDiscountFor(
  coupon: CouponRecord,
  subtotal: number,
): { discount: number } | { error: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (!coupon.isActive) return { error: "This coupon is no longer active." };
  if (coupon.startsOn && today < coupon.startsOn) return { error: "This coupon isn't active yet." };
  if (coupon.expiresOn && today > coupon.expiresOn) return { error: "This coupon has expired." };
  if (coupon.usageLimit !== null && coupon.timesUsed >= coupon.usageLimit) {
    return { error: "This coupon has reached its usage limit." };
  }
  if (subtotal < coupon.minOrderTotal) {
    return { error: `This coupon needs a subtotal of at least ${coupon.minOrderTotal}.` };
  }

  let discount =
    coupon.discountType === "percent"
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;
  if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(Number(discount.toFixed(2)), subtotal);

  if (discount <= 0) return { error: "This coupon gives no discount on this order." };
  return { discount };
}

/** Look a coupon up by code with the service-role client (server-only). */
export async function loadCouponByCode(code: string): Promise<CouponRecord | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("coupons")
    .select(COLUMNS)
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  return data ? toRecord(data as CouponRow) : null;
}

/**
 * Public: check a code typed at checkout. A rejected coupon is a normal
 * outcome, not a crash, so it is returned as `{ ok: false }` instead of
 * thrown — throwing surfaced as an app runtime error overlay.
 */
export type CouponCheckResult =
  | { ok: true; code: string; discount: number }
  | { ok: false; error: string };

export const checkCoupon = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        code: z.string().trim().min(2).max(40),
        subtotal: z.number().nonnegative().max(10_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CouponCheckResult> => {
    const coupon = await loadCouponByCode(data.code);
    if (!coupon) return { ok: false, error: "That coupon code isn't valid." };
    const result = couponDiscountFor(coupon, data.subtotal);
    if ("error" in result) return { ok: false, error: result.error };
    return { ok: true, code: coupon.code, discount: result.discount };
  });

export const ownerListCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CouponRecord[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "coupons", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("coupons")
      .select(COLUMNS)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Coupon list failed", error);
      throw new Error("We couldn't load coupons. Please try again.");
    }
    return (data ?? []).map((row) => toRecord(row as CouponRow));
  });

export const ownerSaveCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        code: z
          .string()
          .trim()
          .min(2)
          .max(40)
          .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _ only."),
        description: z.string().trim().max(160).nullable(),
        discountType: z.enum(["percent", "fixed"]),
        discountValue: z.number().positive().max(1_000_000),
        minOrderTotal: z.number().nonnegative().max(1_000_000),
        maxDiscount: z.number().positive().max(1_000_000).nullable(),
        startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
        usageLimit: z.number().int().positive().max(1_000_000).nullable(),
        isActive: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "coupons");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.discountType === "percent" && data.discountValue > 100) {
      throw new Error("A percentage discount can't be more than 100%.");
    }

    const payload = {
      code: data.code.toUpperCase(),
      description: data.description,
      // The DB constraint accepts only "percent"/"amount"; the app calls a
      // fixed-amount coupon "fixed", so map it before writing.
      discount_type: data.discountType === "fixed" ? "amount" : data.discountType,
      discount_value: data.discountValue,
      min_order_total: data.minOrderTotal,
      max_discount: data.maxDiscount,
      starts_on: data.startsOn,
      expires_on: data.expiresOn,
      usage_limit: data.usageLimit,
      is_active: data.isActive,
    };

    const { error } = data.id
      ? await supabaseAdmin.from("coupons").update(payload).eq("id", data.id)
      : await supabaseAdmin.from("coupons").insert(payload);

    if (error) {
      console.error("Coupon save failed", error);
      if (error.code === "23505") throw new Error("A coupon with that code already exists.");
      throw new Error("We couldn't save this coupon. Please try again.");
    }
    return { ok: true };
  });

export const ownerDeleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "coupons");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("coupons").delete().eq("id", data.id);
    if (error) {
      console.error("Coupon delete failed", error);
      throw new Error("We couldn't delete this coupon. Please try again.");
    }
    return { ok: true };
  });
