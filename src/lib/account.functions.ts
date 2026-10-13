import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MyOrderItem {
  lineId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
}

export interface MyOrder {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  scheduledFor: string | null;
  fulfillment: "delivery" | "pickup";
  paymentMethod: string;
  paymentLabel: string;
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  zoneName: string | null;
  estimatedTime: string | null;
  items: MyOrderItem[];
}

/**
 * Order history for the signed-in customer. Reads through the user-scoped
 * Supabase client, so row-level security guarantees a customer can only ever
 * see their own orders — the filter is enforced by the database, not the UI.
 */
export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyOrder[]> => {
    const { data, error } = await context.supabase
      .from("orders")
      .select(
        "id, code, status, created_at, fulfillment, payment_method, payment_label, subtotal, discount, delivery_charge, total, zone_name, estimated_time, scheduled_for, order_items(*)",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("My orders lookup failed", error);
      throw new Error("We couldn't load your orders. Please try again.");
    }

    return (data ?? []).map((order) => ({
      id: order.id,
      code: order.code,
      status: order.status,
      createdAt: order.created_at,
      scheduledFor: order.scheduled_for,
      fulfillment: order.fulfillment as "delivery" | "pickup",
      paymentMethod: order.payment_method,
      paymentLabel: order.payment_label,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      deliveryCharge: Number(order.delivery_charge),
      total: Number(order.total),
      zoneName: order.zone_name,
      estimatedTime: order.estimated_time,
      items: (order.order_items ?? []).map((i) => ({
        lineId: i.id,
        productId: i.product_id,
        productSlug: i.product_slug,
        productName: i.product_name,
        variantId: i.variant_id,
        variantName: i.variant_name,
        unitPrice: Number(i.unit_price),
        quantity: i.quantity,
        imageUrl: i.image_url,
      })),
    }));
  });
