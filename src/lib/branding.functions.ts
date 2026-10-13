import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { looseDb } from "@/integrations/supabase/loose.server";

const BRAND_BUCKET = "banner-images";
const BRAND_FOLDER = "brand";
const SIGNED_URL_TTL_SECONDS = 50 * 60;
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const BRAND_PATH_PATTERN = /^brand\/(primary|icon)\/[0-9]{10,}-[0-9a-f-]+\.webp$/i;

type BrandKind = "primary" | "icon";

type BrandRow = {
  id: string;
  name: string | null;
  brand_primary_logo_path?: string | null;
  brand_icon_logo_path?: string | null;
  brand_version?: number | null;
  brand_updated_at?: string | null;
  brand_updated_by?: string | null;
};

export type PublicBranding = {
  restaurantName: string;
  primaryLogoUrl: string | null;
  iconLogoUrl: string | null;
  version: number;
  configured: boolean;
};

export type OwnerBranding = PublicBranding & {
  id: string | null;
  primaryLogoPath: string | null;
  iconLogoPath: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  setupRequired: boolean;
};

function defaultBranding(): PublicBranding {
  return {
    restaurantName: "Flamio",
    primaryLogoUrl: null,
    iconLogoUrl: null,
    version: 1,
    configured: false,
  };
}

function createPublicClient(url: string, key: string) {
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

function missingBrandColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  const text = `${maybe.code ?? ""} ${maybe.message ?? ""}`.toLowerCase();
  return text.includes("brand_") || text.includes("schema cache") || text.includes("column");
}

function safePath(path: string | null | undefined): string | null {
  if (!path) return null;
  return BRAND_PATH_PATTERN.test(path) ? path : null;
}

async function signBrandUrls(row: BrandRow): Promise<{ primary: string | null; icon: string | null }> {
  const primaryPath = safePath(row.brand_primary_logo_path);
  const iconPath = safePath(row.brand_icon_logo_path);
  const paths = [...new Set([primaryPath, iconPath].filter((path): path is string => Boolean(path)))];
  if (paths.length === 0) return { primary: null, icon: null };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage
    .from(BRAND_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error("Brand logo signing failed", error);
    return { primary: null, icon: null };
  }
  const signedByPath = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  return {
    primary: primaryPath ? signedByPath.get(primaryPath) ?? null : null,
    icon: iconPath ? signedByPath.get(iconPath) ?? null : null,
  };
}

async function assertOwnerRole(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Owner role check failed", error);
    throw new Error("We couldn't verify owner access. Please try again.");
  }
  if (!data) throw new Error("Only the owner can change brand logos.");
  return supabaseAdmin;
}

export const getPublicBranding = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicBranding> => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return defaultBranding();

    const supabase = createPublicClient(url, key);
    const withBrand = await looseDb(supabase)
      .from("restaurant_settings")
      .select("id,name,brand_primary_logo_path,brand_icon_logo_path,brand_version")
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (withBrand.error) {
      if (!missingBrandColumns(withBrand.error)) console.error("Public branding read failed", withBrand.error);
      const fallback = await looseDb(supabase)
        .from("restaurant_settings")
        .select("name")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return {
        ...defaultBranding(),
        restaurantName: fallback.data?.name ?? "Flamio",
      };
    }

    const row = withBrand.data as BrandRow | null;
    if (!row) return defaultBranding();
    const signed = await signBrandUrls(row);
    return {
      restaurantName: row.name?.trim() || "Flamio",
      primaryLogoUrl: signed.primary,
      iconLogoUrl: signed.icon,
      version: Number(row.brand_version ?? 1) || 1,
      configured: Boolean(safePath(row.brand_primary_logo_path) || safePath(row.brand_icon_logo_path)),
    };
  },
);

export const ownerGetBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerBranding> => {
    const supabaseAdmin = await assertOwnerRole(context.userId);
    const result = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .select(
        "id,name,brand_primary_logo_path,brand_icon_logo_path,brand_version,brand_updated_at,brand_updated_by",
      )
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (result.error) {
      if (!missingBrandColumns(result.error)) console.error("Owner branding read failed", result.error);
      const fallback = await looseDb(supabaseAdmin)
        .from("restaurant_settings")
        .select("id,name")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      return {
        ...defaultBranding(),
        restaurantName: fallback.data?.name ?? "Flamio",
        id: fallback.data?.id ?? null,
        primaryLogoPath: null,
        iconLogoPath: null,
        updatedAt: null,
        updatedBy: null,
        setupRequired: true,
      };
    }

    const row = result.data as BrandRow | null;
    if (!row) {
      return {
        ...defaultBranding(),
        id: null,
        primaryLogoPath: null,
        iconLogoPath: null,
        updatedAt: null,
        updatedBy: null,
        setupRequired: false,
      };
    }

    const signed = await signBrandUrls(row);
    return {
      restaurantName: row.name?.trim() || "Flamio",
      primaryLogoUrl: signed.primary,
      iconLogoUrl: signed.icon,
      version: Number(row.brand_version ?? 1) || 1,
      configured: Boolean(safePath(row.brand_primary_logo_path) || safePath(row.brand_icon_logo_path)),
      id: row.id,
      primaryLogoPath: safePath(row.brand_primary_logo_path),
      iconLogoPath: safePath(row.brand_icon_logo_path),
      updatedAt: row.brand_updated_at ?? null,
      updatedBy: row.brand_updated_by ?? null,
      setupRequired: false,
    };
  });

export const ownerCreateBrandUploadTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["primary", "icon"]),
        contentType: z.enum(ALLOWED_CONTENT_TYPES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ path: string; token: string }> => {
    const supabaseAdmin = await assertOwnerRole(context.userId);
    const path = `${BRAND_FOLDER}/${data.kind}/${Date.now()}-${crypto.randomUUID()}.webp`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BRAND_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !signed?.token) {
      console.error("Brand upload target creation failed", error);
      throw new Error("We couldn't prepare the logo upload. Please try again.");
    }
    return { path, token: signed.token };
  });

export const ownerSaveBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        primaryLogoPath: z.string().trim().max(500).regex(BRAND_PATH_PATTERN).nullable(),
        iconLogoPath: z.string().trim().max(500).regex(BRAND_PATH_PATTERN).nullable(),
        confirm: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertOwnerRole(context.userId);
    const current = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .select("id,brand_version")
      .eq("id", data.id)
      .maybeSingle();

    if (current.error) {
      console.error("Branding setup check failed", current.error);
      throw new Error("Run docs/sql/branding_management.sql before saving brand logos.");
    }
    if (!current.data) throw new Error("Restaurant settings are not set up yet.");

    const version = Math.max(1, Number((current.data as { brand_version?: number | null }).brand_version ?? 1)) + 1;
    const { error } = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .update({
        brand_primary_logo_path: data.primaryLogoPath,
        brand_icon_logo_path: data.iconLogoPath,
        brand_version: version,
        brand_updated_by: context.userId,
        brand_updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (error) {
      console.error("Branding save failed", error);
      throw new Error("We couldn't save the brand logos. Please try again.");
    }
    return { ok: true, version };
  });
