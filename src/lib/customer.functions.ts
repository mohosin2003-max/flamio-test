import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Customer-owned data (saved addresses, favorites, notifications).
 * Every call goes through the user-scoped Supabase client, so row-level
 * security in the database — not the UI — decides what a customer can see.
 */

export interface SavedAddress {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  addressLine: string;
  area: string | null;
  zoneId: string | null;
  landmark: string | null;
  deliveryNotes: string | null;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
}

export interface CustomerNotification {
  id: string;
  orderId: string | null;
  orderCode: string | null;
  status: string | null;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export interface FavoriteRow {
  id: string;
  productId: string;
  productSlug: string;
}

const addressSchema = z.object({
  id: z.string().uuid().nullable(),
  label: z.string().trim().max(40).nullable(),
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(20),
  addressLine: z.string().trim().min(5).max(300),
  area: z.string().trim().max(120).nullable(),
  zoneId: z.string().trim().max(60).nullable(),
  landmark: z.string().trim().max(160).nullable(),
  deliveryNotes: z.string().trim().max(400).nullable(),
  isDefault: z.boolean(),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});

type AddressRow = {
  id: string;
  label: string | null;
  full_name: string;
  phone: string;
  address_line: string;
  area: string | null;
  zone_id: string | null;
  landmark: string | null;
  delivery_notes: string | null;
  is_default: boolean;
  latitude: number | null;
  longitude: number | null;
};

const ADDRESS_COLUMNS =
  "id, label, full_name, phone, address_line, area, zone_id, landmark, delivery_notes, is_default, latitude, longitude";

function toAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    fullName: row.full_name,
    phone: row.phone,
    addressLine: row.address_line,
    area: row.area,
    zoneId: row.zone_id,
    landmark: row.landmark,
    deliveryNotes: row.delivery_notes,
    isDefault: row.is_default,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

export const listAddresses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedAddress[]> => {
    const { data, error } = await context.supabase
      .from("customer_addresses")
      .select(ADDRESS_COLUMNS)
      .eq("user_id", context.userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new Error("We couldn't load your saved addresses.");
    return (data ?? []).map((row) => toAddress(row as AddressRow));
  });

export const saveAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addressSchema.parse(input))
  .handler(async ({ data, context }): Promise<SavedAddress> => {
    const payload = {
      user_id: context.userId,
      label: data.label || null,
      full_name: data.fullName,
      phone: data.phone,
      address_line: data.addressLine,
      area: data.area || null,
      zone_id: data.zoneId || null,
      landmark: data.landmark || null,
      delivery_notes: data.deliveryNotes || null,
      is_default: data.isDefault,
      latitude: data.latitude,
      longitude: data.longitude,
    };

    // Edit in place when the row really belongs to this user; otherwise treat
    // it as a new address (ids coming from the guest/local store never exist
    // in the database, and `.single()` would fail on zero matched rows).
    if (data.id) {
      const { data: updated, error: updateError } = await context.supabase
        .from("customer_addresses")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", context.userId)
        .select(ADDRESS_COLUMNS)
        .maybeSingle();
      if (updateError) {
        console.error("saveAddress update failed", updateError);
        throw new Error(`We couldn't save this address: ${updateError.message}`);
      }
      if (updated) return toAddress(updated as AddressRow);
    }

    const { data: row, error } = await context.supabase
      .from("customer_addresses")
      .insert(payload)
      .select(ADDRESS_COLUMNS)
      .single();
    if (error || !row) {
      console.error("saveAddress insert failed", error);
      throw new Error(
        error?.message
          ? `We couldn't save this address: ${error.message}`
          : "We couldn't save this address. Please try again.",
      );
    }
    return toAddress(row as AddressRow);
  });

export const removeAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("customer_addresses")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error("We couldn't delete this address.");
    return { ok: true };
  });

export const setDefaultAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("customer_addresses")
      .update({ is_default: true })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error("We couldn't set this address as default.");
    return { ok: true };
  });

export const listFavorites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FavoriteRow[]> => {
    const { data, error } = await context.supabase
      .from("favorites")
      .select("id, product_id, product_slug")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("We couldn't load your favorites.");
    return (data ?? []).map((r) => ({
      id: r.id,
      productId: r.product_id,
      productSlug: r.product_slug,
    }));
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        productId: z.string().min(1).max(80),
        productSlug: z.string().min(1).max(120),
        favorite: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.favorite) {
      const { error } = await context.supabase.from("favorites").insert({
        user_id: context.userId,
        product_id: data.productId,
        product_slug: data.productSlug,
      });
      // 23505 = already a favorite, which is the desired end state anyway.
      if (error && error.code !== "23505") throw new Error("We couldn't update your favorites.");
      return { favorite: true };
    }
    const { error } = await context.supabase
      .from("favorites")
      .delete()
      .eq("user_id", context.userId)
      .eq("product_id", data.productId);
    if (error) throw new Error("We couldn't update your favorites.");
    return { favorite: false };
  });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CustomerNotification[]> => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, order_id, order_code, status, title, body, is_read, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) throw new Error("We couldn't load your notifications.");
    return (data ?? []).map((n) => ({
      id: n.id,
      orderId: n.order_id,
      orderCode: n.order_code,
      status: n.status,
      title: n.title,
      body: n.body,
      isRead: n.is_read,
      createdAt: n.created_at,
    }));
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).max(100).nullable() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", context.userId)
      .eq("is_read", false);
    if (data.ids && data.ids.length > 0) query = query.in("id", data.ids);
    const { error } = await query;
    if (error) throw new Error("We couldn't update your notifications.");
    return { ok: true };
  });
