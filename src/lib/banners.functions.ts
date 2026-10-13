import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { PromoBanner } from "@/types/menu";

/**
 * Promotional banners. The public read feeds the EXISTING customer rendering
 * (`HomeCarousel` / `PromoBannerArea` through `restaurantQueryOptions`); an
 * empty list keeps the existing fallback behaviour. Owner writes reuse the
 * same `assertOwner` + service-role pattern as coupons and delivery zones.
 */

type BannerRow = Database["public"]["Tables"]["promo_banners"]["Row"];

const COLUMNS =
  "id,title,subtitle,cta_label,cta_href,desktop_image_path,mobile_image_path,is_active,sort_order";

function toRecord(
  row: BannerRow,
  urls: { desktop: string | null; mobile: string | null } = { desktop: null, mobile: null },
): PromoBanner {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    desktopImagePath: row.desktop_image_path,
    mobileImagePath: row.mobile_image_path,
    desktopImageUrl: urls.desktop,
    mobileImageUrl: urls.mobile,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

async function withSignedUrls(rows: BannerRow[]): Promise<PromoBanner[]> {
  const paths = [...new Set(rows.flatMap((row) => [row.desktop_image_path, row.mobile_image_path]).filter((path): path is string => Boolean(path)))];
  if (paths.length === 0) return rows.map((row) => toRecord(row));

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from("banner-images").createSignedUrls(paths, 60 * 60);
  if (error) console.error("Banner image signing failed", error);
  const signedByPath = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) =>
    toRecord(row, {
      desktop: row.desktop_image_path ? (signedByPath.get(row.desktop_image_path) ?? null) : null,
      mobile: row.mobile_image_path ? (signedByPath.get(row.mobile_image_path) ?? null) : null,
    }),
  );
}

function createPublicClient(url: string, key: string) {
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        // New-format sb_ keys are opaque, not JWTs — send apikey only.
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/** Public: active banners for the home carousel and offers page. Never throws —
 * an empty list means the existing fallback content is used. */
export const getPromoBanners = createServerFn({ method: "GET" }).handler(
  async (): Promise<PromoBanner[]> => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    const url = process.env["SUPABASE_URL"];
    if (!key || !url) return [];

    const supabase = createPublicClient(url, key);
    const { data, error } = await supabase
      .from("promo_banners")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("sort_order")
      .order("title");

    if (error) {
      console.error("Promo banner read failed", error);
      return [];
    }
    return withSignedUrls((data ?? []) as BannerRow[]);
  },
);

export const ownerListPromoBanners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PromoBanner[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "banners", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("promo_banners")
      .select(COLUMNS)
      .order("sort_order")
      .order("title");

    if (error) {
      console.error("Promo banner list failed", error);
      throw new Error("We couldn't load banners. Please try again.");
    }
    return withSignedUrls((data ?? []) as BannerRow[]);
  });

export const ownerSavePromoBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        desktopImagePath: z.string().trim().min(1).max(500),
        mobileImagePath: z.string().trim().min(1).max(500).nullable(),
        clickHref: z
          .string()
          .trim()
          .max(500)
          .nullable()
          .refine(
            (value) =>
              value === null ||
              (value.startsWith("/") && !value.startsWith("//")) ||
              /^https:\/\//i.test(value),
            "Use a Flamio page or a secure HTTPS link.",
          ),
        isActive: z.boolean(),
        sortOrder: z.number().int().min(0).max(999),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "banners");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      title: "Promotional banner",
      subtitle: null,
      cta_label: null,
      cta_href: data.clickHref,
      desktop_image_path: data.desktopImagePath,
      mobile_image_path: data.mobileImagePath,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };

    let oldPaths: string[] = [];
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("promo_banners")
        .select("desktop_image_path,mobile_image_path")
        .eq("id", data.id)
        .maybeSingle();
      oldPaths = [existing?.desktop_image_path, existing?.mobile_image_path].filter(
        (path): path is string => Boolean(path),
      );
    }

    const { error } = data.id
      ? await supabaseAdmin.from("promo_banners").update(payload).eq("id", data.id)
      : await supabaseAdmin.from("promo_banners").insert(payload);

    if (error) {
      console.error("Promo banner save failed", error);
      throw new Error("We couldn't save this banner. Please try again.");
    }
    const retained = new Set([data.desktopImagePath, data.mobileImagePath].filter(Boolean));
    const replaced = oldPaths.filter((path) => !retained.has(path));
    if (replaced.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage.from("banner-images").remove(replaced);
      if (removeError) console.error("Replaced banner image cleanup failed", removeError);
    }
    return { ok: true };
  });

export const ownerDeletePromoBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "banners");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("promo_banners")
      .select("desktop_image_path,mobile_image_path")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("promo_banners").delete().eq("id", data.id);
    if (error) {
      console.error("Promo banner delete failed", error);
      throw new Error("We couldn't delete this banner. Please try again.");
    }
    const paths = [existing?.desktop_image_path, existing?.mobile_image_path].filter(
      (path): path is string => Boolean(path),
    );
    if (paths.length > 0) {
      const { error: removeError } = await supabaseAdmin.storage.from("banner-images").remove(paths);
      if (removeError) console.error("Deleted banner image cleanup failed", removeError);
    }
    return { ok: true };
  });
