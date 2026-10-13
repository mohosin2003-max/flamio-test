import { useEffect } from "react";

import { usePublicBranding } from "@/components/branding/BrandLogo";

const FALLBACK_ICON = "/favicon.png?v=20261009";

function ensureLink(rel: string, type?: string): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  if (type) link.type = type;
  return link;
}

export function BrandingRuntimeHead() {
  const branding = usePublicBranding();
  const iconHref = branding.data?.iconLogoUrl ?? branding.data?.primaryLogoUrl ?? FALLBACK_ICON;

  useEffect(() => {
    const icon = ensureLink("icon", "image/png");
    if (icon) icon.href = iconHref;
    const apple = ensureLink("apple-touch-icon", "image/png");
    if (apple) apple.href = iconHref === FALLBACK_ICON ? "/apple-touch-icon.png?v=20261009" : iconHref;
  }, [iconHref]);

  return null;
}
