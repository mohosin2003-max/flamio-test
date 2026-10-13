import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getPublicBranding } from "@/lib/branding.functions";
import { cn } from "@/lib/utils";

export const FALLBACK_BRAND_NAME = "Flamio";
/** Uploaded Flamio artwork, proportionally resized with safe icon padding. */
export const FALLBACK_BRAND_LOGO_URL = "/icon-192.png?v=20261009";

export function usePublicBranding() {
  const getBranding = useServerFn(getPublicBranding);
  return useQuery({
    queryKey: ["public-branding"],
    queryFn: () => getBranding(),
    staleTime: 30 * 60 * 1000,
  });
}

export function BrandLogo({
  variant = "full",
  showName = false,
  className,
  imageClassName,
  textClassName,
}: {
  variant?: "full" | "icon";
  showName?: boolean;
  className?: string;
  imageClassName?: string;
  textClassName?: string;
}) {
  const branding = usePublicBranding();
  const name = branding.data?.restaurantName?.trim() || FALLBACK_BRAND_NAME;
  const primary = branding.data?.primaryLogoUrl ?? FALLBACK_BRAND_LOGO_URL;
  const icon = branding.data?.iconLogoUrl ?? branding.data?.primaryLogoUrl ?? FALLBACK_BRAND_LOGO_URL;
  const src = variant === "icon" ? icon : primary;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} aria-label={name}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="eager"
        className={cn(
          "shrink-0 rounded-md object-contain shadow-card",
          variant === "icon" ? "size-9" : "h-10 w-auto max-w-32",
          imageClassName,
        )}
      />
      <span
        className={cn(
          showName ? "truncate font-display font-extrabold" : "sr-only",
          textClassName,
        )}
      >
        {name}
      </span>
    </span>
  );
}
