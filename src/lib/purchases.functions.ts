import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PURCHASE_PAYMENT_METHODS = ["Cash", "bKash", "Nagad", "Bank", "Card"] as const;
const purchasePaymentMethodSchema = z.enum(PURCHASE_PAYMENT_METHODS).optional().nullable();

export const calculatePurchaseSubtotal = (quantity: number, unitPrice: number) =>
  Number((quantity * unitPrice).toFixed(2));

/**
 * Ingredient purchase records. Purchases reuse the existing inventory system:
 * a saved purchase raises stock through the existing `apply_stock_change`
 * function, so movements stay in `inventory_movements` like every other change.
 */

export interface PurchaseRecord {
  id: string;
  /**
   * `inventory` keeps the existing stock-raising behaviour. `others` records a
   * pure expense: it never touches inventory stock or movements.
   */
  kind: "inventory" | "others";
  purchasedOn: string;
  supplierName: string;
  itemId: string | null;
  /** Ingredient name for inventory purchases, expense name for others. */
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: string | null;
  paymentMethod: string | null;
  note: string | null;
}

/** Default expense categories for "Others" records. */
export const OTHERS_CATEGORIES = [
  "Rent",
  "Electricity",
  "Maintenance",
  "Shop Purchase",
  "Kitchen Miscellaneous",
  "Labour / Guard",
  "Transport",
  "Cleaning",
  "Equipment / Furniture",
  "Packaging",
  "Other",
] as const;

export const ownerListPurchases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PurchaseRecord[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "purchases", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("purchases")
      .select(
        "id, kind, purchased_on, supplier_name, item_id, quantity, unit_price, total_price, note, expense_name, expense_category, unit_label, payment_method, created_at, inventory_items(name, unit)",
      )
      .order("purchased_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("Purchase list failed", error);
      throw new Error("We couldn't load purchases. Please try again.");
    }

    return (data ?? []).map((row) => {
      const item = row.inventory_items as { name: string; unit: string } | null;
      const kind = (row.kind ?? "inventory") as "inventory" | "others";
      return {
        id: row.id,
        kind,
        purchasedOn: row.purchased_on,
        supplierName: row.supplier_name,
        itemId: row.item_id,
        itemName:
          kind === "others"
            ? (row.expense_name ?? "Expense")
            : (item?.name ?? "Unknown ingredient"),
        unit: kind === "others" ? (row.unit_label ?? "") : (item?.unit ?? ""),
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price),
        totalPrice: Number(row.total_price),
        category: row.expense_category ?? null,
        paymentMethod: row.payment_method ?? null,
        note: row.note ?? null,
      };
    });
  });

export const ownerCreatePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        // Supplier is optional: purchases save fine without one.
        supplierName: z.string().trim().max(80).optional().nullable(),
        itemId: z.string().uuid(),
        quantity: z.number().positive().max(1000000),
        unitPrice: z.number().nonnegative().max(1000000),
        paymentMethod: purchasePaymentMethodSchema,
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "purchases");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const totalPrice = calculatePurchaseSubtotal(data.quantity, data.unitPrice);
    const supplierName = (data.supplierName ?? "").trim();

    const { data: inserted, error } = await supabaseAdmin
      .from("purchases")
      .insert({
        purchased_on: data.purchasedOn,
        supplier_name: supplierName,
        item_id: data.itemId,
        quantity: data.quantity,
        unit_price: data.unitPrice,
        total_price: totalPrice,
        kind: "inventory",
        payment_method: data.paymentMethod ?? null,
        note: data.note?.trim() || null,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("Purchase insert failed", error);
      throw new Error("We couldn't save this purchase. Please try again.");
    }

    // Reuse the existing stock-change mechanism so stock and movement history
    // stay consistent with manual adjustments.
    const { error: stockError } = await supabaseAdmin.rpc("apply_stock_change", {
      _item_id: data.itemId,
      _change_type: "add",
      _quantity: data.quantity,
      _note: supplierName ? `Purchase from ${supplierName}` : "Purchase",
      _created_by: context.userId,
    });

    if (stockError) {
      console.error("Purchase stock increase failed", stockError);
      await supabaseAdmin.from("purchases").delete().eq("id", inserted.id);
      throw new Error("We couldn't update stock for this purchase. Please try again.");
    }

    return { ok: true, id: inserted.id, totalPrice };
  });

/**
 * "Others" expense: recorded in the same `purchases` table with `kind = 'others'`
 * so history, permissions and totals reuse the existing system. It deliberately
 * does NOT call `apply_stock_change`, so inventory stock is untouched and the
 * quantity/unit are descriptive only.
 */
export const ownerCreateOtherExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().trim().min(1).max(120),
        category: z.string().trim().min(1).max(60),
        quantity: z.number().positive().max(1000000),
        unitPrice: z.number().nonnegative().max(1000000),
        supplierName: z.string().trim().max(80).optional().nullable(),
        paymentMethod: purchasePaymentMethodSchema,
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "purchases");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const subtotal = calculatePurchaseSubtotal(data.quantity, data.unitPrice);

    const { data: inserted, error } = await supabaseAdmin
      .from("purchases")
      .insert({
        kind: "others",
        purchased_on: data.purchasedOn,
        supplier_name: (data.supplierName ?? "").trim(),
        item_id: null,
        expense_name: data.name,
        expense_category: data.category,
        quantity: data.quantity,
        unit_label: null,
        unit_price: data.unitPrice,
        total_price: subtotal,
        payment_method: data.paymentMethod ?? null,
        note: data.note?.trim() || null,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("Other expense insert failed", error);
      throw new Error("We couldn't save this expense. Please try again.");
    }

    return { ok: true, id: inserted.id, totalPrice: subtotal };
  });

/**
 * Owner/Admin-only edit of a saved purchase. For inventory purchases the stock
 * difference (new quantity − old quantity) is applied through the existing
 * `apply_stock_change` function in ONE movement, so stock history stays the
 * audit trail. The ingredient itself cannot be changed here. "Others" records
 * never touch stock.
 */
export const ownerUpdatePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        quantity: z.number().nonnegative().max(1000000),
        /** Unit price for inventory purchases; full amount for "others". */
        price: z.number().nonnegative().max(100000000),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readError } = await supabaseAdmin
      .from("purchases")
      .select("id, kind, item_id, quantity")
      .eq("id", data.id)
      .maybeSingle();
    if (readError || !existing) throw new Error("This purchase could not be found.");

    const note = data.note?.trim() || null;

    if ((existing.kind ?? "inventory") === "others") {
      const amount = Number(data.price.toFixed(2));
      const { error } = await supabaseAdmin
        .from("purchases")
        .update({ purchased_on: data.purchasedOn, quantity: data.quantity, unit_price: amount, total_price: amount, note })
        .eq("id", data.id);
      if (error) throw new Error("We couldn't update this expense. Please try again.");
      return { ok: true };
    }

    if (!existing.item_id) throw new Error("This purchase has no ingredient linked.");
    if (data.quantity <= 0) throw new Error("Quantity must be more than 0.");

    const oldQty = Number(existing.quantity);
    const diff = Number((data.quantity - oldQty).toFixed(3));
    let stockChanged = false;
    if (diff !== 0) {
      const { error: stockError } = await supabaseAdmin.rpc("apply_stock_change", {
        _item_id: existing.item_id,
        _change_type: diff > 0 ? "add" : "reduce",
        _quantity: Math.abs(diff),
        _note: "Purchase edited",
        _created_by: context.userId,
      });
      if (stockError) {
        throw new Error(
          stockError.message.includes("Not enough stock")
            ? "Not enough stock left to lower this purchase — some of it has already been used."
            : "We couldn't update stock for this edit. Please try again.",
        );
      }
      stockChanged = true;
    }

    const { error } = await supabaseAdmin
      .from("purchases")
      .update({
        purchased_on: data.purchasedOn,
        quantity: data.quantity,
        unit_price: data.price,
        total_price: Number((data.quantity * data.price).toFixed(2)),
        note,
      })
      .eq("id", data.id);

    if (error) {
      console.error("Purchase update failed", error);
      if (stockChanged) {
        // Undo the stock difference so stock matches the unchanged purchase.
        await supabaseAdmin.rpc("apply_stock_change", {
          _item_id: existing.item_id,
          _change_type: diff > 0 ? "reduce" : "add",
          _quantity: Math.abs(diff),
          _note: "Purchase edit reverted",
          _created_by: context.userId,
        });
      }
      throw new Error("We couldn't update this purchase. Please try again.");
    }
    return { ok: true };
  });

/**
 * Owner/Admin-only delete. An inventory purchase first reverses its stock
 * through `apply_stock_change` ("reduce"); if that stock was already used the
 * delete is refused, so stock can never go negative.
 */
export const ownerDeletePurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readError } = await supabaseAdmin
      .from("purchases")
      .select("id, kind, item_id, quantity")
      .eq("id", data.id)
      .maybeSingle();
    if (readError || !existing) throw new Error("This purchase could not be found.");

    const reverse = (existing.kind ?? "inventory") === "inventory" && existing.item_id && Number(existing.quantity) > 0;
    if (reverse) {
      const { error: stockError } = await supabaseAdmin.rpc("apply_stock_change", {
        _item_id: existing.item_id!,
        _change_type: "reduce",
        _quantity: Number(existing.quantity),
        _note: "Purchase deleted",
        _created_by: context.userId,
      });
      if (stockError) {
        throw new Error(
          stockError.message.includes("Not enough stock")
            ? "Can't delete — some of this purchase's stock has already been used."
            : "We couldn't reverse stock for this purchase. Please try again.",
        );
      }
    }

    const { error } = await supabaseAdmin.from("purchases").delete().eq("id", data.id);
    if (error) {
      console.error("Purchase delete failed", error);
      if (reverse) {
        await supabaseAdmin.rpc("apply_stock_change", {
          _item_id: existing.item_id!,
          _change_type: "add",
          _quantity: Number(existing.quantity),
          _note: "Purchase delete reverted",
          _created_by: context.userId,
        });
      }
      throw new Error("We couldn't delete this purchase. Please try again.");
    }
    return { ok: true };
  });
