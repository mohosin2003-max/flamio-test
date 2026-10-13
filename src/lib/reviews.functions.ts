import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ReviewSettings {
  reviewsEnabled: boolean;
  photosEnabled: boolean;
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerName: string;
  reviewerAvatarUrl: string | null;
  photoUrl: string | null;
  verifiedOrder: boolean;
}

export interface ProductReviewSummary {
  average: number;
  count: number;
  reviews: PublicReview[];
}

export interface MyReview {
  id: string;
  rating: number;
  comment: string | null;
  photoPath: string | null;
  photoUrl: string | null;
  productId: string | null;
  status: string;
  createdAt: string;
}

export interface ReviewableOrder {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  items: { productId: string; productName: string }[];
}

/** Only the first name is ever shown publicly — never phone, address or ids. */
function publicName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : "Flamio customer";
}

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  photo_path: string | null;
  created_at: string;
  status: string;
  user_id: string | null;
  order_id?: string | null;
  product_id?: string | null;
  orders?: { code: string } | null;
  products?: { name: string } | null;
};

type ProfileRow = { id: string; full_name: string | null; avatar_path?: string | null };

function loose(client: unknown) {
  // General (order-less) reviews live in external Supabase migrations and the
  // generated types can lag behind them.
  return client as any;
}

async function signedUrlMap(client: unknown, bucket: string, paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  const { data } = await loose(client).storage.from(bucket).createSignedUrls(paths, 60 * 60);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }
  return signed;
}

async function profileMap(client: unknown, userIds: string[]): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const { data } = await loose(client)
    .from("profiles")
    .select("id, full_name, avatar_path")
    .in("id", userIds);
  return new Map((data ?? []).map((p: ProfileRow) => [p.id, p]));
}

function reviewName(row: ReviewRow, profiles: Map<string, ProfileRow>): string {
  return publicName(row.user_id ? (profiles.get(row.user_id)?.full_name ?? null) : null);
}

function pathBelongsTo(path: string | null, userId: string, label: string): string | null {
  if (!path) return null;
  if (!path.startsWith(`${userId}/`)) throw new Error(`${label} doesn't belong to your account.`);
  return path;
}

function uniqueUserIds(rows: ReviewRow[]): string[] {
  return Array.from(new Set(rows.flatMap((row) => (row.user_id ? [row.user_id] : []))));
}

function nonEmptyPaths(paths: Array<string | null | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path));
}

/**
 * Reviews on/off and photos on/off, from the existing restaurant settings row.
 * Public because the product page needs it before sign-in.
 */
export const getReviewSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<ReviewSettings> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("restaurant_settings")
      .select("reviews_enabled, review_photos_enabled")
      .limit(1)
      .maybeSingle();
    return {
      reviewsEnabled: data?.reviews_enabled !== false,
      photosEnabled: data?.review_photos_enabled !== false,
    };
  },
);

/**
 * Approved reviews for one dish. Read with the service client so the response
 * can be reduced to safe fields only (rating, text, first name, photo) — the
 * reviewer's account id, phone and address never leave the server.
 */
export const listProductReviews = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<ProductReviewSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: settings }, { data: rows, error }] = await Promise.all([
      supabaseAdmin.from("restaurant_settings").select("reviews_enabled, review_photos_enabled").limit(1).maybeSingle(),
      loose(supabaseAdmin)
        .from("order_reviews")
        .select("id, rating, comment, photo_path, created_at, user_id, order_id")
        .eq("product_id", data.productId)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (error || settings?.reviews_enabled === false) {
      if (error) console.error("Product reviews lookup failed", error);
      return { average: 0, count: 0, reviews: [] };
    }

    const reviews = (rows ?? []) as ReviewRow[];
    if (reviews.length === 0) return { average: 0, count: 0, reviews: [] };

    const profiles = await profileMap(supabaseAdmin, uniqueUserIds(reviews));

    const photosOn = settings?.review_photos_enabled !== false;
    const paths = photosOn ? nonEmptyPaths(reviews.map((r) => r.photo_path)) : [];
    const avatarPaths = Array.from(new Set(nonEmptyPaths([...profiles.values()].map((p) => p.avatar_path))));
    const [signed, signedAvatars] = await Promise.all([
      signedUrlMap(supabaseAdmin, "review-photos", paths),
      signedUrlMap(supabaseAdmin, "profile-photos", avatarPaths),
    ]);

    const total = reviews.reduce((sum: number, r: ReviewRow) => sum + r.rating, 0);
    return {
      average: Math.round((total / reviews.length) * 10) / 10,
      count: reviews.length,
      reviews: reviews.map((r: ReviewRow) => {
        const profile = r.user_id ? profiles.get(r.user_id) : undefined;
        return {
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.created_at,
          reviewerName: reviewName(r, profiles),
          reviewerAvatarUrl: profile?.avatar_path ? (signedAvatars.get(profile.avatar_path) ?? null) : null,
          photoUrl: r.photo_path ? (signed.get(r.photo_path) ?? null) : null,
          verifiedOrder: Boolean(r.order_id),
        };
      }),
    };
  });

/** Approved customer reviews for the bottom-of-page public review section. */
export const listPublicReviews = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProductReviewSummary> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: settings }, { data: rows, error }] = await Promise.all([
      supabaseAdmin.from("restaurant_settings").select("reviews_enabled, review_photos_enabled").limit(1).maybeSingle(),
      loose(supabaseAdmin)
        .from("order_reviews")
        .select("id, rating, comment, photo_path, created_at, user_id, order_id")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

    if (error || settings?.reviews_enabled === false) {
      if (error) console.error("Public reviews lookup failed", error);
      return { average: 0, count: 0, reviews: [] };
    }

    const reviews = (rows ?? []) as ReviewRow[];
    if (reviews.length === 0) return { average: 0, count: 0, reviews: [] };

    const profiles = await profileMap(supabaseAdmin, uniqueUserIds(reviews));
    const photosOn = settings?.review_photos_enabled !== false;
    const photoPaths = photosOn ? nonEmptyPaths(reviews.map((r) => r.photo_path)) : [];
    const avatarPaths = Array.from(new Set(nonEmptyPaths([...profiles.values()].map((p) => p.avatar_path))));

    const [photoUrls, avatarUrls] = await Promise.all([
      signedUrlMap(supabaseAdmin, "review-photos", photoPaths),
      signedUrlMap(supabaseAdmin, "profile-photos", avatarPaths),
    ]);

    const total = reviews.reduce((sum, review) => sum + review.rating, 0);
    return {
      average: Math.round((total / reviews.length) * 10) / 10,
      count: reviews.length,
      reviews: reviews.map((review) => {
        const profile = review.user_id ? profiles.get(review.user_id) : undefined;
        return {
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.created_at,
          reviewerName: reviewName(review, profiles),
          reviewerAvatarUrl: profile?.avatar_path ? (avatarUrls.get(profile.avatar_path) ?? null) : null,
          photoUrl: review.photo_path ? (photoUrls.get(review.photo_path) ?? null) : null,
          verifiedOrder: Boolean(review.order_id),
        };
      }),
    };
  },
);

/** General customer review (no order required). Signed-in customers only. */
export const submitGeneralReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().min(2).max(1000),
        photoPath: z.string().trim().max(300).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const { data: settings } = await supabaseAdmin
      .from("restaurant_settings")
      .select("reviews_enabled, review_photos_enabled")
      .limit(1)
      .maybeSingle();
    if (settings?.reviews_enabled === false) {
      throw new Error("Reviews are turned off right now.");
    }

    const photosAllowed = settings?.review_photos_enabled !== false;
    const photoPath = photosAllowed ? pathBelongsTo(data.photoPath, userId, "That photo") : null;

    const { error } = await loose(supabaseAdmin).from("order_reviews").insert({
      order_id: null,
      user_id: userId,
      product_id: null,
      rating: data.rating,
      comment: data.comment,
      photo_path: photoPath,
      status: "pending",
    });
    if (error) {
      console.error("General review insert failed", error);
      if (error.code === "23502") {
        throw new Error("General reviews need the latest review database update before they can be collected.");
      }
      throw new Error("We couldn't save your review. Please try again.");
    }
    return { ok: true };
  });

/**
 * The order the customer wants to review plus their existing review, if any.
 * Row-level security guarantees a customer can only ever load their own order.
 */
export const getOrderReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(
    async ({ data, context }): Promise<{ order: ReviewableOrder | null; review: MyReview | null }> => {
      const { data: order } = await context.supabase
        .from("orders")
        .select("id, code, status, created_at, order_items(product_id, product_name)")
        .eq("id", data.orderId)
        .eq("user_id", context.userId)
        .maybeSingle();

      if (!order) return { order: null, review: null };

      const { data: reviewRow } = await loose(context.supabase)
        .from("order_reviews")
        .select("id, rating, comment, photo_path, product_id, status, created_at")
        .eq("order_id", data.orderId)
        .eq("user_id", context.userId)
        .maybeSingle();
      const review = reviewRow as ReviewRow | null;

      let photoUrl: string | null = null;
      if (review?.photo_path) {
        const { data: signed } = await context.supabase.storage
          .from("review-photos")
          .createSignedUrl(review.photo_path, 60 * 60);
        photoUrl = signed?.signedUrl ?? null;
      }

      const seen = new Set<string>();
      const items: ReviewableOrder["items"] = [];
      for (const item of order.order_items ?? []) {
        if (seen.has(item.product_id)) continue;
        seen.add(item.product_id);
        items.push({ productId: item.product_id, productName: item.product_name });
      }

      return {
        order: {
          id: order.id,
          code: order.code,
          status: order.status,
          createdAt: order.created_at,
          items,
        },
        review: review
          ? {
              id: review.id,
              rating: review.rating,
              comment: review.comment,
              photoPath: review.photo_path,
              photoUrl,
              productId: review.product_id ?? null,
              status: review.status,
              createdAt: review.created_at,
            }
          : null,
      };
    },
  );

/**
 * Saves (or updates) the customer's review for one of their own completed
 * orders. Every rule is checked server-side: ownership, order status, one
 * review per order, and that a photo path belongs to this customer's folder.
 */
export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        productId: z.string().uuid().nullable(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).nullable(),
        photoPath: z.string().trim().max(300).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: settings } = await supabaseAdmin
      .from("restaurant_settings")
      .select("reviews_enabled, review_photos_enabled")
      .limit(1)
      .maybeSingle();
    if (settings?.reviews_enabled === false) {
      throw new Error("Reviews are turned off right now.");
    }

    // Ownership and status are verified against the customer's own order.
    const { data: order } = await context.supabase
      .from("orders")
      .select("id, status")
      .eq("id", data.orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error("We couldn't find that order.");
    if (order.status !== "completed") {
      throw new Error("You can review this order once it's completed.");
    }

    const photoPath =
      settings?.review_photos_enabled === false
        ? null
        : pathBelongsTo(data.photoPath, context.userId, "That photo");

    // The order line must really contain the dish being reviewed.
    if (data.productId) {
      const { data: line } = await context.supabase
        .from("order_items")
        .select("id")
        .eq("order_id", data.orderId)
        .eq("product_id", data.productId)
        .limit(1)
        .maybeSingle();
      if (!line) throw new Error("That dish isn't part of this order.");
    }

    const { data: existing } = await loose(context.supabase)
      .from("order_reviews")
      .select("id, photo_path")
      .eq("order_id", data.orderId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (existing) {
      const { error } = await loose(context.supabase)
        .from("order_reviews")
        .update({
          rating: data.rating,
          comment: data.comment,
          product_id: data.productId,
          photo_path: photoPath,
          // An edited review goes back for approval.
          status: "pending",
        })
        .eq("id", existing.id);
      if (error) {
        console.error("Review update failed", error);
        throw new Error("We couldn't save your review. Please try again.");
      }
      if (existing.photo_path && existing.photo_path !== photoPath) {
        await context.supabase.storage.from("review-photos").remove([existing.photo_path]);
      }
      return { ok: true, updated: true };
    }

    const { error } = await loose(context.supabase).from("order_reviews").insert({
      order_id: data.orderId,
      user_id: context.userId,
      product_id: data.productId,
      rating: data.rating,
      comment: data.comment,
      photo_path: photoPath,
    });
    if (error) {
      console.error("Review insert failed", error);
      // 23505 = the unique (order, customer) guard already holds a review.
      if (error.code === "23505") throw new Error("You've already reviewed this order.");
      throw new Error("We couldn't save your review. Please try again.");
    }
    return { ok: true, updated: false };
  });

export interface OwnerReview {
  id: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: string;
  orderId: string;
  orderCode: string;
  productName: string | null;
  customerName: string;
  photoUrl: string | null;
  verifiedOrder: boolean;
}

export const ownerListReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerReview[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "reviews", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await loose(supabaseAdmin)
      .from("order_reviews")
      .select(
        "id, rating, comment, status, created_at, order_id, photo_path, user_id, orders(code), products(name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("Owner reviews lookup failed", error);
      throw new Error("We couldn't load the reviews. Please try again.");
    }

    const rows = (data ?? []) as ReviewRow[];
    const profiles = await profileMap(supabaseAdmin, uniqueUserIds(rows));

    const paths = nonEmptyPaths(rows.map((r) => r.photo_path));
    const signed = await signedUrlMap(supabaseAdmin, "review-photos", paths);

    return rows.map((r: ReviewRow) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      status: r.status,
      createdAt: r.created_at,
      orderId: r.order_id ?? "",
      orderCode: (r.orders as { code: string } | null)?.code ?? "",
      productName: (r.products as { name: string } | null)?.name ?? null,
      customerName: reviewName(r, profiles),
      photoUrl: r.photo_path ? (signed.get(r.photo_path) ?? null) : null,
      verifiedOrder: Boolean(r.order_id),
    }));
  });

export const ownerSetReviewStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "approved", "hidden"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "reviews");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("order_reviews")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error("We couldn't update this review. Please try again.");
    return { ok: true };
  });

export const ownerDeleteReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "reviews");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rowData } = await loose(supabaseAdmin)
      .from("order_reviews")
      .select("photo_path")
      .eq("id", data.id)
      .maybeSingle();
    const row = rowData as Pick<ReviewRow, "photo_path"> | null;

    const { error } = await supabaseAdmin.from("order_reviews").delete().eq("id", data.id);
    if (error) throw new Error("We couldn't remove this review. Please try again.");
    if (row?.photo_path) {
      await supabaseAdmin.storage.from("review-photos").remove([row.photo_path]);
    }
    return { ok: true };
  });
