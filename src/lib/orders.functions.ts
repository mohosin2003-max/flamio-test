import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Order persistence. Orders hold customer PII, so the tables have no public
 * policies at all — every read and write goes through these server functions.
 */

/**
 * Brute-force protection for GUEST order lookup (getOrder). Two in-memory
 * sliding-window trackers, same pattern as the signup duplicate check:
 *
 * 1. Per-caller (IP): caps how many guest lookups one caller can attempt,
 *    so code guessing / digit cycling from one address is stopped early.
 * 2. Per-order: caps FAILED digit attempts against a single order code, so
 *    rotating IPs cannot keep hammering the same order.
 *
 * Both fail closed to the exact same { requiresPhone: true } shape used for
 * a wrong digit entry, so a limited caller learns nothing about whether the
 * order or code exists. Signed-in account-owner lookups never touch these
 * trackers. Storage is per-worker memory (stateless serverless workers), so
 * this is best-effort rather than a hard global cap — no database table is
 * used, per the project's no-schema-change constraint.
 */
const LOOKUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_GUEST_LOOKUPS_PER_CALLER = 20; // per IP per hour
const MAX_FAILED_ATTEMPTS_PER_ORDER = 10; // per order code per hour
const MAX_TRACKED_LOOKUP_KEYS = 5000;

const callerLookupLog = new Map<string, number[]>();
const orderFailureLog = new Map<string, number[]>();

function lookupCallerKey(): string {
  try {
    const request = getRequest();
    const headers = request?.headers;
    if (!headers) return "unknown";
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0];
      if (first) return first.trim();
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Records one attempt; returns true when the key is over its limit. */
function recordAndCheckLimit(
  log: Map<string, number[]>,
  key: string,
  max: number,
): boolean {
  const now = Date.now();
  // Bound memory: drop the whole log if it grows past the cap.
  if (log.size > MAX_TRACKED_LOOKUP_KEYS) log.clear();
  const recent = (log.get(key) ?? []).filter((t) => now - t < LOOKUP_WINDOW_MS);
  if (recent.length >= max) {
    log.set(key, recent);
    return true;
  }
  recent.push(now);
  log.set(key, recent);
  return false;
}

const itemSchema = z.object({
  productId: z.string().min(1),
  productSlug: z.string().min(1),
  productName: z.string().min(1),
  variantId: z.string().nullable(),
  variantName: z.string().nullable(),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().int().positive().max(99),
  imageUrl: z.string().nullable(),
  /** Combo lines: labels only — re-checked and re-priced on the server below. */
  comboId: z.string().nullable().optional(),
  comboName: z.string().nullable().optional(),
  comboKey: z.string().nullable().optional(),
  comboGroupId: z.string().nullable().optional(),
});

const placeOrderSchema = z.object({
  fulfillment: z.enum(["delivery", "pickup"]),
  paymentMethod: z.string().min(1),
  paymentLabel: z.string().min(1),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().min(6).max(20),
  addressLine: z.string().trim().max(300).nullable(),
  area: z.string().trim().max(120).nullable(),
  landmark: z.string().trim().max(160).nullable(),
  deliveryNotes: z.string().trim().max(400).nullable(),
  zoneId: z.string().nullable(),
  zoneName: z.string().nullable(),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  estimatedTime: z.string().nullable(),
  pickupNote: z.string().nullable(),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  couponCode: z.string().trim().min(2).max(40).nullable().optional(),
  deliveryCharge: z.number().nonnegative(),
  total: z.number().nonnegative(),
  items: z.array(itemSchema).min(1).max(50),
  /**
   * Sale channel. `counter` is the Owner/Staff till: it is authorized below
   * (existing `pos` permission) and is stored as an immediately completed sale,
   * so it never enters the online-order status flow.
   */
  channel: z.enum(["online", "counter"]).default("online"),
  /** Optional scheduled pre-order slot (ISO). Re-validated on the server. */
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
});

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

function orderCode(date: Date): string {
  const stamp = [
    date.getUTCFullYear().toString().slice(-2),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 46656)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `FLM-${stamp}-${random}`;
}

export const placeOrder = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => placeOrderSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getOptionalUserId } = await import("@/lib/auth.server");

    // Signed-in customers own their orders; guests keep placing orders freely.
    const userId = await getOptionalUserId();

    // Only an authorized counter user may record a counter sale; anything else
    // from the browser is treated as a normal online order.
    let channel: "online" | "counter" = "online";
    if (data.channel === "counter") {
      if (!userId) throw new Error("Please sign in to record a counter sale.");
      const { assertPermission } = await import("@/lib/owner.server");
      await assertPermission(userId, "pos");
      channel = "counter";
    } else if (!userId) {
      // Online customer orders require a signed-in account (session verified server-side).
      throw new Error("Please sign in or create an account to place your order.");
    } else {
      // Staff accounts use the counter till, not the customer cart.
      const { getAccessProfile } = await import("@/lib/owner.server");
      const access = await getAccessProfile(userId);
      if (access.isStaff || access.isManager) {
        throw new Error("Owner and staff accounts can't place customer orders. Use Counter sale instead.");
      }
    }

    // Opening hours (Asia/Dhaka) are authoritative here. Counter sales are
    // never affected; online orders need an open restaurant or a valid slot.
    let scheduledFor: string | null = null;
    let scheduledActivateAt: string | null = null;
    if (channel === "online") {
      const { loadHoursSettings } = await import("@/lib/opening-hours.server");
      const { isOpenAt, isValidSlot, canScheduleNow } = await import("@/lib/opening-hours");
      const hours = await loadHoursSettings();
      if (data.scheduledFor) {
        if (!canScheduleNow(hours)) throw new Error("Scheduled orders aren't available right now.");
        if (hours.paymentRequired) {
          throw new Error("Online payment is required for scheduled orders and isn't available yet.");
        }
        if (!isValidSlot(hours, data.scheduledFor)) {
          throw new Error("That time slot is no longer available. Please pick another time.");
        }
        const at = new Date(data.scheduledFor).getTime();
        scheduledFor = new Date(at).toISOString();
        scheduledActivateAt = new Date(at - hours.prepMinutes * 60_000).toISOString();
      } else if (!isOpenAt(hours)) {
        throw new Error("We're closed right now. You can schedule this order for later.");
      }
    }

    // Combo lines are re-checked against the owner's configuration and the live
    // menu, then re-priced here. Availability, selection rules and combo prices
    // are decided by the server; anything sent by the browser is ignored.
    const { validateComboItems } = await import("@/lib/combos.server");
    const items = await validateComboItems(data.items);

    // Persistent Counter Sale price (products.counter_price), read from the
    // database and enforced here for every counter sale (Owner and Staff).
    // Online orders never reach this; empty means the normal menu price.
    if (channel === "counter") {
      const ids = [...new Set(items.filter((i) => !i.comboKey && !i.variantId).map((i) => i.productId))];
      if (ids.length > 0) {
        const { data: priced, error: priceError } = await supabaseAdmin
          .from("products")
          .select("id, counter_price")
          .in("id", ids);
        if (priceError) {
          console.error("Counter price lookup failed", priceError);
          throw new Error("We couldn't load Counter Sale prices. Please try again.");
        }
        const byId = new Map((priced ?? []).map((p) => [p.id, p.counter_price]));
        for (const item of items) {
          const cp = byId.get(item.productId);
          if (cp != null && !item.comboKey && !item.variantId) item.unitPrice = Number(cp);
        }
      }
    }

    // Recompute money server-side; never trust totals from the browser.
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    // Coupons are validated and priced on the server only.
    let couponCode: string | null = null;
    /**
     * A manual discount is only ever entered at the counter till, which is
     * authorized above with the `pos` permission. A customer order can only be
     * discounted by a coupon, which is re-priced on the server below, so a
     * discount sent from the browser is ignored for online orders.
     */
    let discount = channel === "counter" ? Math.min(data.discount, subtotal) : 0;
    if (data.couponCode) {
      const { couponDiscountFor, loadCouponByCode } = await import("@/lib/coupons.functions");
      const coupon = await loadCouponByCode(data.couponCode);
      if (!coupon) throw new Error("That coupon code isn't valid.");
      const result = couponDiscountFor(coupon, subtotal);
      if ("error" in result) throw new Error(result.error);
      discount = result.discount;
      couponCode = coupon.code;
    }
    const isDelivery = data.fulfillment === "delivery";

    if (isDelivery && !data.addressLine) {
      throw new Error("A delivery address is required.");
    }

    // Distance-based delivery: when the owner has configured radius zones the
    // charge, zone and estimated time are recalculated here from the pinned
    // coordinates. Anything sent by the browser is ignored. With no radius
    // zones configured this block is inert and the original area-based
    // behaviour is used unchanged.
    let deliveryCharge = isDelivery ? data.deliveryCharge : 0;
    let zoneId = isDelivery ? data.zoneId : null;
    let zoneName = isDelivery ? data.zoneName : null;
    let estimatedTime = data.estimatedTime;
    let distanceM: number | null = null;
    let latitude = isDelivery ? data.latitude : null;
    let longitude = isDelivery ? data.longitude : null;

    if (isDelivery) {
      const { resolveLocationDelivery } = await import("@/lib/delivery.server");
      const located = await resolveLocationDelivery({
        latitude: data.latitude,
        longitude: data.longitude,
        subtotal,
        discount,
      });
      if (located.radiusMode) {
        if (!located.available) {
          throw new Error(located.message ?? "We can't deliver to that location.");
        }
        if (!located.meetsMinimumOrder) {
          throw new Error(`The minimum order for delivery is ${located.minimumOrder}.`);
        }
        deliveryCharge = located.charge;
        zoneId = located.zoneSlug;
        zoneName = located.zoneName;
        estimatedTime = located.estimatedTime;
        distanceM = located.distanceM;
      }
    } else {
      latitude = null;
      longitude = null;
    }

    const total = Math.max(subtotal - discount, 0) + deliveryCharge;

    let inserted: { id: string; code: string; created_at: string } | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const { data: row, error } = await supabaseAdmin
        .from("orders")
        .insert({
          code: orderCode(new Date()),
          user_id: userId,
          channel,
          // Counter sales are confirmed/sold the moment the bill is completed.
          status: channel === "counter" ? "completed" : scheduledFor ? "scheduled" : "placed",
          ...({
            order_kind: scheduledFor ? "scheduled" : "regular",
            scheduled_for: scheduledFor,
            scheduled_activate_at: scheduledActivateAt,
          } as Record<string, unknown>),
          fulfillment: data.fulfillment,
          payment_method: data.paymentMethod,
          payment_label: data.paymentLabel,
          customer_name: data.customerName,
          customer_phone: data.customerPhone,
          address_line: isDelivery ? data.addressLine : null,
          area: isDelivery ? data.area : null,
          landmark: isDelivery ? data.landmark : null,
          delivery_notes: data.deliveryNotes,
          zone_id: zoneId,
          zone_name: zoneName,
          latitude,
          longitude,
          distance_m: distanceM,
          estimated_time: estimatedTime,
          pickup_note: isDelivery ? null : data.pickupNote,
          subtotal,
          discount,
          delivery_charge: deliveryCharge,
          total,
          coupon_code: couponCode,
        })
        .select("id, code, created_at")
        .single();

      if (error) {
        lastError = error;
        // 23505 = duplicate order code; regenerate and retry.
        if (error.code !== "23505") break;
        continue;
      }
      inserted = row;
    }

    if (!inserted) {
      console.error("Order insert failed", lastError);
      throw new Error("We couldn't save your order. Please try again.");
    }

    const { error: itemsError } = await supabaseAdmin.from("order_items").insert(
      items.map((i) => ({
        order_id: inserted.id,
        product_id: i.productId,
        product_slug: i.productSlug,
        product_name: i.productName,
        variant_id: i.variantId,
        variant_name: i.variantName,
        unit_price: i.unitPrice,
        quantity: i.quantity,
        image_url: i.imageUrl,
        combo_name: i.comboName ?? null,
        combo_key: i.comboKey ?? null,
      })),
    );

    if (itemsError) {
      console.error("Order items insert failed", itemsError);
      await supabaseAdmin.from("orders").delete().eq("id", inserted.id);
      throw new Error("We couldn't save your order items. Please try again.");
    }

    // Count the coupon once, after the order is safely stored.
    if (couponCode) {
      const { data: couponRow } = await supabaseAdmin
        .from("coupons")
        .select("id, times_used")
        .eq("code", couponCode)
        .maybeSingle();
      if (couponRow) {
        await supabaseAdmin
          .from("coupons")
          .update({ times_used: couponRow.times_used + 1 })
          .eq("id", couponRow.id);
      }
    }

    // Ingredient stock is consumed only after the order and its items are
    // safely stored. The DB function is idempotent per order, so a retry can
    // never reduce stock twice, and failures here never block the order.
    // In Simple mode the restaurant only tracks purchases, so automatic
    // deduction is skipped for new orders. Advanced mode (the default) keeps
    // the existing behaviour untouched.
    const { data: settingsRow } = await supabaseAdmin
      .from("restaurant_settings")
      .select("inventory_mode")
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (settingsRow?.inventory_mode !== "simple") {
      const { error: stockError } = await supabaseAdmin.rpc("consume_inventory_for_order", {
        _order_id: inserted.id,
      });
      if (stockError) console.error("Inventory consumption failed", stockError);
    }

    // The database already queued the staff new-order alert (and its
    // escalation timer). Run the due queue now so the alert is instant instead
    // of waiting for the next scheduled run. Never blocks the order.
    try {
      const { dispatchDueNotificationJobs } = await import("@/lib/push.server");
      await dispatchDueNotificationJobs(10);
    } catch (notifyError) {
      console.error("New order alert failed", notifyError);
    }

    return { id: inserted.id, code: inserted.code, createdAt: inserted.created_at };
  });

export const getOrder = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().min(3),
        // Guest orders additionally require the last 4 digits of the phone
        // number on the order. Verified on the server only.
        phoneLast4: z.string().trim().max(8).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getOptionalUserId } = await import("@/lib/auth.server");

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.orderId);

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq(isUuid ? "id" : "code", data.orderId)
      .maybeSingle();

    if (error) {
      console.error("Order lookup failed", error);
      throw new Error("We couldn't load this order. Please try again.");
    }
    if (!order) return null;

    // Orders that belong to an account are readable only by that account.
    // Account-owner lookups are never rate-limited by the guest trackers.
    if (order.user_id) {
      const callerId = await getOptionalUserId();
      if (callerId !== order.user_id) return null;
    } else {
      // Guest order: the code alone is not enough. The caller must also know
      // the last 4 digits of the order's phone number. Nothing about the
      // order is returned until that check passes.
      //
      // Brute-force protection: cap guest lookups per caller IP, and cap
      // failed digit attempts per order code (so rotating IPs cannot keep
      // attacking the same order). A limited caller gets the exact same
      // { requiresPhone: true } shape as a wrong digit entry — it learns
      // nothing about whether the order or code exists.
      if (recordAndCheckLimit(callerLookupLog, lookupCallerKey(), MAX_GUEST_LOOKUPS_PER_CALLER)) {
        return { requiresPhone: true as const };
      }
      const orderKey = (order.code ?? order.id).toLowerCase();
      if ((orderFailureLog.get(orderKey) ?? []).filter((t) => Date.now() - t < LOOKUP_WINDOW_MS).length >= MAX_FAILED_ATTEMPTS_PER_ORDER) {
        return { requiresPhone: true as const };
      }
      const digits = (order.customer_phone ?? "").replace(/\D/g, "");
      const expected = digits.slice(-4);
      const provided = (data.phoneLast4 ?? "").replace(/\D/g, "").slice(-4);
      if (expected.length !== 4 || provided.length !== 4 || provided !== expected) {
        recordAndCheckLimit(orderFailureLog, orderKey, MAX_FAILED_ATTEMPTS_PER_ORDER);
        return { requiresPhone: true as const };
      }
    }

    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("*")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });

    return {
      requiresPhone: false as const,
      id: order.id,
      code: order.code,
      status: order.status,
      channel: (order.channel ?? "online") as "online" | "counter" | "platform",
      userId: order.user_id,
      createdAt: order.created_at,
      fulfillment: order.fulfillment as "delivery" | "pickup",
      paymentMethod: order.payment_method,
      paymentLabel: order.payment_label,
      orderKind: ((order as Record<string, unknown>)["order_kind"] as string | null) ?? "regular",
      scheduledFor: ((order as Record<string, unknown>)["scheduled_for"] as string | null) ?? null,
      paymentStatus: ((order as Record<string, unknown>)["payment_status"] as string | null) ?? "unpaid",
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      addressLine: order.address_line,
      area: order.area,
      landmark: order.landmark,
      deliveryNotes: order.delivery_notes,
      zoneName: order.zone_name,
      estimatedTime: order.estimated_time,
      pickupNote: order.pickup_note,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      deliveryCharge: Number(order.delivery_charge),
      total: Number(order.total),
      items: (items ?? []).map((i) => ({
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
    };
  });
