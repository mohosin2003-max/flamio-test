import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { looseDb } from "@/integrations/supabase/loose.server";

export interface PublicRestaurantInfo {
  name: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  isOpen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  facebookPageName: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  ownerPhone: string | null;
  messengerUrl: string | null;
  whatsappNumber: string | null;
  contactCallRestaurantEnabled: boolean;
  contactCallOwnerEnabled: boolean;
  contactInboxEnabled: boolean;
  contactFacebookEnabled: boolean;
  contactMessengerEnabled: boolean;
  contactWhatsappEnabled: boolean;
  primaryLogoUrl: string | null;
  iconLogoUrl: string | null;
  brandVersion: number;
}

const BRAND_PATH_PATTERN = /^brand\/(primary|icon)\/[0-9]{10,}-[0-9a-f-]+\.webp$/i;

function missingBrandColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  const text = `${maybe.code ?? ""} ${maybe.message ?? ""}`.toLowerCase();
  return text.includes("brand_") || text.includes("schema cache") || text.includes("column");
}

function safeBrandPath(path: string | null | undefined): string | null {
  if (!path) return null;
  return BRAND_PATH_PATTERN.test(path) ? path : null;
}

async function signBrandUrls(row: { brand_primary_logo_path?: string | null; brand_icon_logo_path?: string | null }) {
  const primaryPath = safeBrandPath(row.brand_primary_logo_path);
  const iconPath = safeBrandPath(row.brand_icon_logo_path);
  const paths = [...new Set([primaryPath, iconPath].filter((path): path is string => Boolean(path)))];
  if (paths.length === 0) return { primary: null, icon: null };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.storage.from("banner-images").createSignedUrls(paths, 50 * 60);
  if (error) {
    console.error("Public restaurant brand signing failed", error);
    return { primary: null, icon: null };
  }
  const signedByPath = new Map((data ?? []).map((item) => [item.path, item.signedUrl]));
  return {
    primary: primaryPath ? signedByPath.get(primaryPath) ?? null : null,
    icon: iconPath ? signedByPath.get(iconPath) ?? null : null,
  };
}

/** Public, read-only restaurant profile for customer pages. Never throws —
 * returns null on failure so callers can fall back to bundled defaults. */
export const getPublicRestaurantInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRestaurantInfo | null> => {
    const supabasePublic = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await looseDb(supabasePublic)
      .from("restaurant_settings")
      .select(
        "name, tagline, phone, email, address_line, city, country, is_open, opens_at, closes_at, facebook_page_name, facebook_url, instagram_url, google_maps_url, owner_phone, messenger_url, whatsapp_number, contact_call_restaurant_enabled, contact_call_owner_enabled, contact_inbox_enabled, contact_facebook_enabled, contact_messenger_enabled, contact_whatsapp_enabled, brand_primary_logo_path, brand_icon_logo_path, brand_version",
      )
      .order("created_at")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      if (error && !missingBrandColumns(error)) console.error("Public restaurant info load failed", error);
      if (error && missingBrandColumns(error)) {
        const fallback = await looseDb(supabasePublic)
          .from("restaurant_settings")
          .select(
            "name, tagline, phone, email, address_line, city, country, is_open, opens_at, closes_at, facebook_page_name, facebook_url, instagram_url, google_maps_url, owner_phone, messenger_url, whatsapp_number, contact_call_restaurant_enabled, contact_call_owner_enabled, contact_inbox_enabled, contact_facebook_enabled, contact_messenger_enabled, contact_whatsapp_enabled",
          )
          .order("created_at")
          .limit(1)
          .maybeSingle();
        if (fallback.error || !fallback.data) return null;
        return {
          name: fallback.data.name,
          tagline: fallback.data.tagline,
          phone: fallback.data.phone,
          email: fallback.data.email,
          addressLine: fallback.data.address_line,
          city: fallback.data.city,
          country: fallback.data.country,
          isOpen: fallback.data.is_open,
          opensAt: fallback.data.opens_at,
          closesAt: fallback.data.closes_at,
          facebookPageName: fallback.data.facebook_page_name,
          facebookUrl: fallback.data.facebook_url,
          instagramUrl: fallback.data.instagram_url,
          googleMapsUrl: fallback.data.google_maps_url,
          ownerPhone: fallback.data.owner_phone,
          messengerUrl: fallback.data.messenger_url,
          whatsappNumber: fallback.data.whatsapp_number,
          contactCallRestaurantEnabled: fallback.data.contact_call_restaurant_enabled !== false,
          contactCallOwnerEnabled: fallback.data.contact_call_owner_enabled === true,
          contactInboxEnabled: fallback.data.contact_inbox_enabled !== false,
          contactFacebookEnabled: fallback.data.contact_facebook_enabled !== false,
          contactMessengerEnabled: fallback.data.contact_messenger_enabled === true,
          contactWhatsappEnabled: fallback.data.contact_whatsapp_enabled === true,
          primaryLogoUrl: null,
          iconLogoUrl: null,
          brandVersion: 1,
        };
      }
      return null;
    }

    const signed = await signBrandUrls(data);

    return {
      name: data.name,
      tagline: data.tagline,
      phone: data.phone,
      email: data.email,
      addressLine: data.address_line,
      city: data.city,
      country: data.country,
      isOpen: data.is_open,
      opensAt: data.opens_at,
      closesAt: data.closes_at,
      facebookPageName: data.facebook_page_name,
      facebookUrl: data.facebook_url,
      instagramUrl: data.instagram_url,
      googleMapsUrl: data.google_maps_url,
      ownerPhone: data.owner_phone,
      messengerUrl: data.messenger_url,
      whatsappNumber: data.whatsapp_number,
      contactCallRestaurantEnabled: data.contact_call_restaurant_enabled !== false,
      contactCallOwnerEnabled: data.contact_call_owner_enabled === true,
      contactInboxEnabled: data.contact_inbox_enabled !== false,
      contactFacebookEnabled: data.contact_facebook_enabled !== false,
      contactMessengerEnabled: data.contact_messenger_enabled === true,
      contactWhatsappEnabled: data.contact_whatsapp_enabled === true,
      primaryLogoUrl: signed.primary,
      iconLogoUrl: signed.icon,
      brandVersion: Number(data.brand_version ?? 1) || 1,
    };
  },
);
