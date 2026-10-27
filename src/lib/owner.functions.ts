import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Owner / admin management endpoints. Every handler re-checks the caller's
 * role server-side (`assertOwner`) before touching data with the service-role
 * client — route protection in the UI is convenience only.
 *
 * These reuse the EXISTING tables (categories, products, product_images,
 * orders) and the existing order status lifecycle. Nothing is duplicated.
 */

export interface OwnerOrderRow {
  id: string;
  orderKind?: string;
  scheduledFor?: string | null;
  paymentStatus?: string;
  code: string;
  status: string;
  /** Where the sale came from: online order, counter sale or platform sale. */
  channel: "online" | "counter" | "platform";
  /** Unread customer messages in this order's thread. */
  unreadMessages: number;
  /** Whether the existing order thread contains any customer-authored message. */
  hasCustomerMessage?: boolean;
  fulfillment: "delivery" | "pickup";
  customerName: string;
  customerPhone: string;
  total: number;
  createdAt: string;
  addressLine: string | null;
  area: string | null;
  paymentLabel: string;
  riderId: string | null;
  riderName: string | null;
  landmark: string | null;
  deliveryNotes: string | null;
  items: {
    productId: string | null;
    name: string;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    imageUrl: string | null;
    comboName: string | null;
  }[];
}

export interface OwnerOrderDetail extends OwnerOrderRow {
  /** Name of the Owner/Staff member who recorded the sale (counter channel only). */
  recordedByName?: string | null;
  paymentMethod: string;
  couponCode: string | null;
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  pickupNote: string | null;
  zoneName: string | null;
  estimatedTime: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceM: number | null;
  riderPhone: string | null;
}

export interface OwnerCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isVisible: boolean;
  sortOrder: number;
  productCount: number;
}

export interface OwnerProduct {
  id: string;
  categoryId: string;
  slug: string;
  name: string;
  description: string | null;
  basePrice: number;
  /** Persistent Counter Sale price; null = use basePrice. */
  counterPrice?: number | null;
  isAvailable: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
  imageUrl: string | null;
}

export interface RestaurantSettings {
  id: string;
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  isOpen: boolean;
  inventoryMode: "simple" | "advanced";
  opensAt: string | null;
  closesAt: string | null;
  facebookPageName: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  recommendationsEnabled: boolean;
  recommendationsCount: number;
  reviewsEnabled: boolean;
  reviewPhotosEnabled: boolean;
  reviewReminderDelayMinutes: number;
  staffAckTimeoutMinutes: number;
  staffOrderSoundEnabled: boolean;
  ownerEscalationEnabled: boolean;
  ownerPhone: string | null;
  messengerUrl: string | null;
  whatsappNumber: string | null;
  contactCallRestaurantEnabled: boolean;
  contactCallOwnerEnabled: boolean;
  contactInboxEnabled: boolean;
  contactFacebookEnabled: boolean;
  contactMessengerEnabled: boolean;
  contactWhatsappEnabled: boolean;
}

/**
 * What can the caller open in the dashboard? Owners/managers are unrestricted;
 * staff get exactly the permissions switched on for them. Also reports whether
 * ownership is unclaimed.
 */
export const getOwnerAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getAccessProfile } = await import("@/lib/owner.server");

    const [{ data: mine }, access] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      getAccessProfile(context.userId),
    ]);

    const roles = (mine ?? []).map((r) => r.role as string);

    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner");

    const { serializeOwnerAccess } = await import("@/lib/access-shape");
    return serializeOwnerAccess(access, roles, count ?? 0);
  });

/** First-run bootstrap: the first signed-in user may claim ownership once. */
export const claimOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner");

    if ((count ?? 0) > 0) throw new Error("Ownership has already been claimed.");

    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "owner" });

    if (error) {
      console.error("Claim ownership failed", error);
      throw new Error("We couldn't set up owner access. Please try again.");
    }
    return { ok: true };
  });

export const ownerListOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerOrderRow[]> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["online_orders", "order_management"], "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, code, status, channel, fulfillment, customer_name, customer_phone, total, created_at, address_line, area, landmark, delivery_notes, payment_label, order_kind, scheduled_for, payment_status, rider_id, riders(name), order_items(product_id, product_name, variant_name, quantity, unit_price, image_url, combo_name, created_at)",
      )
      .in("channel", ["online", "counter"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Owner order list failed", error);
      throw new Error("We couldn't load orders. Please try again.");
    }

    // Unread customer messages per order, from the existing message threads.
    const ids = (data ?? []).map((o) => o.id);
    const unread = new Map<string, number>();
    if (ids.length > 0) {
      const { data: messageRows } = await supabaseAdmin
        .from("order_messages")
        .select("order_id")
        .in("order_id", ids)
        .eq("sender_role", "customer")
        .eq("read_by_staff", false);
      for (const m of messageRows ?? []) {
        unread.set(m.order_id, (unread.get(m.order_id) ?? 0) + 1);
      }
    }

    const productIds = Array.from(new Set((data ?? []).flatMap((o) =>
      (o.order_items ?? []).filter((item) => !item.image_url && item.product_id).map((item) => item.product_id as string),
    )));
    const currentImages = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: images } = await supabaseAdmin
        .from("product_images")
        .select("product_id, url, is_primary, sort_order")
        .in("product_id", productIds)
        .not("url", "is", null)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      for (const image of images ?? []) {
        if (image.url && !currentImages.has(image.product_id)) currentImages.set(image.product_id, image.url);
      }
    }

    return (data ?? []).map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      channel: (o.channel ?? "online") as "online" | "counter" | "platform",
      unreadMessages: unread.get(o.id) ?? 0,
      fulfillment: o.fulfillment as "delivery" | "pickup",
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      total: Number(o.total),
      createdAt: o.created_at,
      addressLine: o.address_line,
      area: o.area,
      paymentLabel: o.payment_label,
      orderKind: o.order_kind,
      scheduledFor: o.scheduled_for,
      paymentStatus: o.payment_status,
      riderId: o.rider_id,
      riderName: o.riders?.name ?? null,
      landmark: o.landmark,
      deliveryNotes: o.delivery_notes,
      items: (o.order_items ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({
          productId: item.product_id,
          name: item.product_name,
          variantName: item.variant_name,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          imageUrl: item.image_url ?? (item.product_id ? currentImages.get(item.product_id) ?? null : null),
          comboName: item.combo_name,
        })),
    }));
  });

export const ownerGetOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data: input, context }): Promise<OwnerOrderDetail | null> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["online_orders", "order_management"], "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, code, status, channel, user_id, fulfillment, customer_name, customer_phone, created_at, address_line, area, landmark, delivery_notes, pickup_note, zone_name, estimated_time, latitude, longitude, distance_m, payment_method, payment_label, coupon_code, subtotal, discount, delivery_charge, total, rider_id, riders(name, phone), order_items(product_id, product_name, variant_name, quantity, unit_price, image_url, combo_name, created_at)",
      )
      .eq("id", input.orderId)
      .maybeSingle();

    if (error) {
      console.error("Owner order detail failed", error);
      throw new Error("We couldn't load this order. Please try again.");
    }
    if (!order) return null;

    // Counter Sale only: resolve the name of the user who recorded the sale.
    let recordedByName: string | null = null;
    if (order.channel === "counter" && order.user_id) {
      const { data: recorder } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", order.user_id)
        .maybeSingle();
      recordedByName = recorder?.full_name ?? null;
    }


    const missingProductIds = Array.from(new Set((order.order_items ?? [])
      .filter((item) => !item.image_url && item.product_id)
      .map((item) => item.product_id as string)));
    const currentImages = new Map<string, string>();
    if (missingProductIds.length > 0) {
      const { data: images } = await supabaseAdmin
        .from("product_images")
        .select("product_id, url, is_primary, sort_order")
        .in("product_id", missingProductIds)
        .not("url", "is", null)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      for (const image of images ?? []) {
        if (image.url && !currentImages.has(image.product_id)) currentImages.set(image.product_id, image.url);
      }
    }

    const [{ count: customerMessageCount }, { count: unreadMessages }] = await Promise.all([
      supabaseAdmin
        .from("order_messages")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id)
        .eq("sender_role", "customer"),
      supabaseAdmin
        .from("order_messages")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id)
        .eq("sender_role", "customer")
        .eq("read_by_staff", false),
    ]);

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      channel: (order.channel ?? "online") as "online" | "counter" | "platform",
      unreadMessages: unreadMessages ?? 0,
      hasCustomerMessage: (customerMessageCount ?? 0) > 0,
      fulfillment: order.fulfillment as "delivery" | "pickup",
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      total: Number(order.total),
      createdAt: order.created_at,
      addressLine: order.address_line,
      area: order.area,
      landmark: order.landmark,
      deliveryNotes: order.delivery_notes,
      pickupNote: order.pickup_note,
      recordedByName,
      zoneName: order.zone_name,
      estimatedTime: order.estimated_time,
      latitude: order.latitude == null ? null : Number(order.latitude),
      longitude: order.longitude == null ? null : Number(order.longitude),
      distanceM: order.distance_m == null ? null : Number(order.distance_m),
      paymentMethod: order.payment_method,
      paymentLabel: order.payment_label,
      couponCode: order.coupon_code,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      deliveryCharge: Number(order.delivery_charge),
      riderId: order.rider_id,
      riderName: order.riders?.name ?? null,
      riderPhone: order.riders?.phone ?? null,
      items: (order.order_items ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((item) => ({
          productId: item.product_id,
          name: item.product_name,
          variantName: item.variant_name,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          imageUrl: item.image_url ?? (item.product_id ? currentImages.get(item.product_id) ?? null : null),
          comboName: item.combo_name,
        })),
    };
  });

/**
 * Advances an order ONE step through the existing status lifecycle, or cancels
 * it. Forward-only: the caller sends the order id and the intended status, and
 * anything that is not the immediate next status (or a cancellation) is
 * rejected here. The same rules are enforced by a database trigger.
 */
export const ownerUpdateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum([
          "placed",
          "confirmed",
          "preparing",
          "ready",
          "out_for_delivery",
          "completed",
          "cancelled",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "order_management");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canCancelOrder, isForwardTransition, isOnlineChannel } = await import(
      "@/lib/order-flow"
    );

    const { data: order, error: loadError } = await supabaseAdmin
      .from("orders")
      .select("id, status, channel, fulfillment")
      .eq("id", data.orderId)
      .maybeSingle();

    if (loadError) {
      console.error("Owner status update lookup failed", loadError);
      throw new Error("We couldn't update this order. Please try again.");
    }
    if (!order) throw new Error("This order no longer exists.");

    const fulfillment = order.fulfillment as "delivery" | "pickup";

    if (!isOnlineChannel(order.channel)) {
      throw new Error("Counter and platform sales are already completed sales.");
    }
    if (order.status === data.status) return { ok: true, status: order.status };
    if (order.status === "completed" || order.status === "cancelled") {
      throw new Error("This order is already closed and can't be changed.");
    }

    if (data.status === "cancelled") {
      if (!canCancelOrder(order.status, order.channel)) {
        throw new Error("This order can no longer be cancelled.");
      }
    } else if (!isForwardTransition(order.status, data.status, fulfillment)) {
      throw new Error("Order status can only move forward one step.");
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: data.status })
      .eq("id", data.orderId)
      .eq("status", order.status);

    if (error) {
      console.error("Owner status update failed", error);
      throw new Error("We couldn't update this order. Please try again.");
    }
    return { ok: true, status: data.status };
  });

/** Full catalog including hidden categories and unavailable items. */
export const ownerGetCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({ context }): Promise<{ categories: OwnerCategory[]; products: OwnerProduct[] }> => {
      const { assertAnyPermission } = await import("@/lib/owner.server");
      await assertAnyPermission(context.userId, ["menu", "pos"], "view");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [{ data: categories }, { data: products }, { data: images }] = await Promise.all([
        supabaseAdmin
          .from("categories")
          .select("id, slug, name, description, image_url, is_visible, sort_order")
          .order("sort_order"),
        supabaseAdmin
          .from("products")
          .select(
            "id, category_id, slug, name, description, base_price, counter_price, is_available, is_featured, is_popular, sort_order",
          )
          .order("sort_order"),
        supabaseAdmin
          .from("product_images")
          .select("product_id, url, is_primary, sort_order")
          .order("sort_order"),
      ]);

      const imageByProduct = new Map<string, string | null>();
      for (const img of images ?? []) {
        if (!imageByProduct.has(img.product_id) || img.is_primary) {
          imageByProduct.set(img.product_id, img.url);
        }
      }

      const counts = new Map<string, number>();
      for (const p of products ?? []) {
        counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
      }

      return {
        categories: (categories ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          imageUrl: c.image_url,
          isVisible: c.is_visible,
          sortOrder: c.sort_order,
          productCount: counts.get(c.id) ?? 0,
        })),
        products: (products ?? []).map((p) => ({
          id: p.id,
          categoryId: p.category_id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          basePrice: Number(p.base_price),
          counterPrice: p.counter_price == null ? null : Number(p.counter_price),
          isAvailable: p.is_available,
          isFeatured: p.is_featured,
          isPopular: p.is_popular,
          sortOrder: p.sort_order,
          imageUrl: imageByProduct.get(p.id) ?? null,
        })),
      };
    },
  );

export const ownerSaveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        name: z.string().trim().min(2).max(60),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(60)
          .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes only."),
        description: z.string().trim().max(300).nullable(),
        imageUrl: z.string().trim().url().max(500).nullable(),
        isVisible: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      image_url: data.imageUrl,
      is_visible: data.isVisible,
      sort_order: data.sortOrder,
    };

    const query = data.id
      ? supabaseAdmin.from("categories").update(row).eq("id", data.id)
      : supabaseAdmin.from("categories").insert(row);

    const { error } = await query;
    if (error) {
      console.error("Save category failed", error);
      throw new Error(
        error.code === "23505"
          ? "Another category already uses that link (slug)."
          : "We couldn't save this category. Please try again.",
      );
    }
    return { ok: true };
  });

/**
 * Deletes a category. Items are never deleted silently: the caller must either
 * empty the category first or pass `reassignTo` so its items are moved.
 */
export const ownerDeleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        reassignTo: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("category_id", data.id);

    if ((count ?? 0) > 0) {
      if (!data.reassignTo) {
        throw new Error("Choose a category to move this category's items into first.");
      }
      if (data.reassignTo === data.id) {
        throw new Error("Pick a different category to move the items into.");
      }

      const { data: target } = await supabaseAdmin
        .from("categories")
        .select("id")
        .eq("id", data.reassignTo)
        .maybeSingle();
      if (!target) throw new Error("That destination category no longer exists.");

      const { error: moveError } = await supabaseAdmin
        .from("products")
        .update({ category_id: data.reassignTo })
        .eq("category_id", data.id);

      if (moveError) {
        console.error("Reassign products failed", moveError);
        throw new Error("We couldn't move this category's items. Nothing was deleted.");
      }
    }

    const { error } = await supabaseAdmin.from("categories").delete().eq("id", data.id);
    if (error) {
      console.error("Delete category failed", error);
      throw new Error("We couldn't delete this category. Please try again.");
    }
    return { ok: true, moved: count ?? 0 };
  });


export const ownerSaveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        categoryId: z.string().uuid(),
        name: z.string().trim().min(2).max(80),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes only."),
        description: z.string().trim().max(500).nullable(),
        basePrice: z.number().nonnegative().max(1000000),
        isAvailable: z.boolean(),
        isFeatured: z.boolean(),
        isPopular: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
        imageUrl: z.string().trim().url().max(500).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = {
      category_id: data.categoryId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      base_price: data.basePrice,
      is_available: data.isAvailable,
      is_featured: data.isFeatured,
      is_popular: data.isPopular,
      sort_order: data.sortOrder,
    };

    let productId = data.id ?? null;

    if (productId) {
      const { error } = await supabaseAdmin.from("products").update(row).eq("id", productId);
      if (error) {
        console.error("Update product failed", error);
        throw new Error(
          error.code === "23505"
            ? "Another item already uses that link (slug)."
            : "We couldn't save this item. Please try again.",
        );
      }
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("products")
        .insert(row)
        .select("id")
        .single();
      if (error || !inserted) {
        console.error("Insert product failed", error);
        throw new Error(
          error?.code === "23505"
            ? "Another item already uses that link (slug)."
            : "We couldn't save this item. Please try again.",
        );
      }
      productId = inserted.id;
    }

    // One primary image row per product (the customer app falls back to the
    // bundled category placeholder while `url` is null).
    const { data: existingImage } = await supabaseAdmin
      .from("product_images")
      .select("id")
      .eq("product_id", productId)
      .order("sort_order")
      .limit(1)
      .maybeSingle();

    if (existingImage) {
      await supabaseAdmin
        .from("product_images")
        .update({ url: data.imageUrl, alt: data.name })
        .eq("id", existingImage.id);
    } else {
      await supabaseAdmin
        .from("product_images")
        .insert({ product_id: productId, url: data.imageUrl, alt: data.name, is_primary: true });
    }

    return { ok: true, id: productId };
  });

export const ownerSetProductAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isAvailable: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("products")
      .update({ is_available: data.isAvailable })
      .eq("id", data.id);

    if (error) {
      console.error("Availability update failed", error);
      throw new Error("We couldn't update availability. Please try again.");
    }
    return { ok: true };
  });

export const ownerDeleteProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("products").delete().eq("id", data.id);
    if (error) {
      console.error("Delete product failed", error);
      throw new Error("We couldn't delete this item. Please try again.");
    }
    return { ok: true };
  });

export const ownerGetSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RestaurantSettings | null> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");

    const { data } = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .select(
        "id, name, tagline, phone, email, address_line, city, country, is_open, inventory_mode, opens_at, closes_at, facebook_page_name, facebook_url, instagram_url, google_maps_url, recommendations_enabled, recommendations_count, reviews_enabled, review_photos_enabled, review_reminder_delay_minutes, staff_ack_timeout_minutes, staff_order_sound_enabled, owner_escalation_enabled, owner_phone, messenger_url, whatsapp_number, contact_call_restaurant_enabled, contact_call_owner_enabled, contact_inbox_enabled, contact_facebook_enabled, contact_messenger_enabled, contact_whatsapp_enabled",
      )
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      tagline: data.tagline,
      phone: data.phone,
      email: data.email,
      addressLine: data.address_line,
      city: data.city,
      country: data.country,
      isOpen: data.is_open,
      inventoryMode: (data.inventory_mode === "simple" ? "simple" : "advanced") as
        | "simple"
        | "advanced",
      opensAt: data.opens_at,
      closesAt: data.closes_at,
      facebookPageName: data.facebook_page_name,
      facebookUrl: data.facebook_url,
      instagramUrl: data.instagram_url,
      googleMapsUrl: data.google_maps_url,
      recommendationsEnabled: data.recommendations_enabled !== false,
      recommendationsCount: Number(data.recommendations_count ?? 6) || 6,
      reviewsEnabled: data.reviews_enabled !== false,
      reviewPhotosEnabled: data.review_photos_enabled !== false,
      reviewReminderDelayMinutes: Number(data.review_reminder_delay_minutes ?? 5) || 5,
      staffAckTimeoutMinutes: Number(data.staff_ack_timeout_minutes ?? 2) || 2,
      staffOrderSoundEnabled: data.staff_order_sound_enabled !== false,
      ownerEscalationEnabled: data.owner_escalation_enabled !== false,
      ownerPhone: data.owner_phone,
      messengerUrl: data.messenger_url,
      whatsappNumber: data.whatsapp_number,
      contactCallRestaurantEnabled: data.contact_call_restaurant_enabled !== false,
      contactCallOwnerEnabled: data.contact_call_owner_enabled === true,
      contactInboxEnabled: data.contact_inbox_enabled !== false,
      contactFacebookEnabled: data.contact_facebook_enabled !== false,
      contactMessengerEnabled: data.contact_messenger_enabled === true,
      contactWhatsappEnabled: data.contact_whatsapp_enabled === true,
    };
  });

export const ownerUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(2).max(80),
        tagline: z.string().trim().max(160).nullable(),
        phone: z.string().trim().max(30).nullable(),
        email: z.string().trim().max(120).nullable(),
        addressLine: z.string().trim().max(200).nullable(),
        city: z.string().trim().max(80).nullable(),
        country: z.string().trim().max(80).nullable(),
        isOpen: z.boolean(),
        inventoryMode: z.enum(["simple", "advanced"]),
        opensAt: z.string().trim().max(30).nullable(),
        closesAt: z.string().trim().max(30).nullable(),
        facebookPageName: z.string().trim().max(100).nullable(),
        facebookUrl: z.string().trim().max(300).nullable(),
        instagramUrl: z.string().trim().max(300).nullable(),
        googleMapsUrl: z.string().trim().max(500).nullable(),
        recommendationsEnabled: z.boolean(),
        recommendationsCount: z.number().int().min(1).max(12),
        reviewsEnabled: z.boolean(),
        reviewPhotosEnabled: z.boolean(),
        reviewReminderDelayMinutes: z.number().int().min(0).max(1440),
        staffAckTimeoutMinutes: z.number().int().min(1).max(120),
        staffOrderSoundEnabled: z.boolean(),
        ownerEscalationEnabled: z.boolean(),
        ownerPhone: z.string().trim().max(30).nullable(),
        messengerUrl: z.string().trim().max(500).nullable(),
        whatsappNumber: z.string().trim().max(30).nullable(),
        contactCallRestaurantEnabled: z.boolean(),
        contactCallOwnerEnabled: z.boolean(),
        contactInboxEnabled: z.boolean(),
        contactFacebookEnabled: z.boolean(),
        contactMessengerEnabled: z.boolean(),
        contactWhatsappEnabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");

    const { error } = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .update({
        name: data.name,
        tagline: data.tagline,
        phone: data.phone,
        email: data.email,
        address_line: data.addressLine,
        city: data.city,
        country: data.country,
        is_open: data.isOpen,
        inventory_mode: data.inventoryMode,
        opens_at: data.opensAt,
        closes_at: data.closesAt,
        facebook_page_name: data.facebookPageName,
        facebook_url: data.facebookUrl,
        instagram_url: data.instagramUrl,
        google_maps_url: data.googleMapsUrl,
        recommendations_enabled: data.recommendationsEnabled,
        recommendations_count: data.recommendationsCount,
        reviews_enabled: data.reviewsEnabled,
        review_photos_enabled: data.reviewPhotosEnabled,
        review_reminder_delay_minutes: data.reviewReminderDelayMinutes,
        staff_ack_timeout_minutes: data.staffAckTimeoutMinutes,
        staff_order_sound_enabled: data.staffOrderSoundEnabled,
        owner_escalation_enabled: data.ownerEscalationEnabled,
        owner_phone: data.ownerPhone,
        messenger_url: data.messengerUrl,
        whatsapp_number: data.whatsappNumber,
        contact_call_restaurant_enabled: data.contactCallRestaurantEnabled,
        contact_call_owner_enabled: data.contactCallOwnerEnabled,
        contact_inbox_enabled: data.contactInboxEnabled,
        contact_facebook_enabled: data.contactFacebookEnabled,
        contact_messenger_enabled: data.contactMessengerEnabled,
        contact_whatsapp_enabled: data.contactWhatsappEnabled,
      })
      .eq("id", data.id);

    if (error) {
      console.error("Settings update failed", error);
      throw new Error("We couldn't save settings. Please try again.");
    }
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Product variants (sizes / options) — reuses the existing            */
/* public.product_variants table. No new storage.                      */
/* ------------------------------------------------------------------ */

export type OwnerVariant = {
  id: string;
  productId: string;
  name: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
};

export const ownerListVariants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<OwnerVariant[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("product_variants")
      .select("id, product_id, name, price, is_available, sort_order")
      .eq("product_id", data.productId)
      .order("sort_order");

    if (error) {
      console.error("List variants failed", error);
      throw new Error("We couldn't load the options for this item.");
    }

    return (rows ?? []).map((v) => ({
      id: v.id,
      productId: v.product_id,
      name: v.name,
      price: Number(v.price),
      isAvailable: v.is_available,
      sortOrder: v.sort_order,
    }));
  });

export const ownerSaveVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        productId: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
        price: z.number().nonnegative().max(1000000),
        isAvailable: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = {
      product_id: data.productId,
      name: data.name,
      price: data.price,
      is_available: data.isAvailable,
      sort_order: data.sortOrder,
    };

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("product_variants")
        .update(row)
        .eq("id", data.id);
      if (error) {
        console.error("Update variant failed", error);
        throw new Error("We couldn't save this option. Please try again.");
      }
      return { ok: true, id: data.id };
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("product_variants")
      .insert(row)
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("Insert variant failed", error);
      throw new Error("We couldn't add this option. Please try again.");
    }
    return { ok: true, id: inserted.id };
  });

export const ownerDeleteVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "menu");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("product_variants").delete().eq("id", data.id);
    if (error) {
      console.error("Delete variant failed", error);
      throw new Error("We couldn't delete this option. Please try again.");
    }
    return { ok: true };
  });

/** Owner/Admin-only: set (or clear with null) a product's persistent Counter Sale price. */
export const ownerSetCounterPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ productId: z.string().uuid(), price: z.number().nonnegative().max(1000000).nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const price = data.price == null ? null : Math.round(data.price * 100) / 100;
    const { error } = await supabaseAdmin.from("products").update({ counter_price: price }).eq("id", data.productId);
    if (error) {
      console.error("Counter price save failed", error);
      throw new Error("We couldn't save the Counter Sale price. Please try again.");
    }
    return { ok: true, price };
  });
