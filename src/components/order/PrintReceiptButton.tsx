import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FALLBACK_BRAND_LOGO_URL, FALLBACK_BRAND_NAME, usePublicBranding } from "@/components/branding/BrandLogo";
import { Button } from "@/components/ui/button";
import { printReceipt, type ReceiptData } from "@/lib/receipt";
import { getPublicRestaurantInfo } from "@/lib/restaurant.functions";

export type PrintReceiptOrder = Omit<
  ReceiptData,
  "brandName" | "logoUrl" | "restaurantPhone" | "restaurantEmail" | "restaurantAddress"
>;

/**
 * Optional receipt print control. Printing is never required: the order is
 * already saved before this renders, and a cancelled or failed print changes
 * nothing — the cashier can simply press it again.
 */
export function PrintReceiptButton({
  order,
  label = "Print Receipt",
  size = "sm",
  variant = "outline",
  className,
}: {
  order: PrintReceiptOrder;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  className?: string;
}) {
  const branding = usePublicBranding();
  const getInfo = useServerFn(getPublicRestaurantInfo);
  const info = useQuery({
    queryKey: ["public-restaurant-info"],
    queryFn: () => getInfo(),
    staleTime: 10 * 60 * 1000,
  });
  const [printing, setPrinting] = useState(false);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const address = [info.data?.addressLine, info.data?.city, info.data?.country]
        .filter((part) => Boolean(part && part.trim()))
        .join(", ");
      await printReceipt({
        ...order,
        brandName: branding.data?.restaurantName?.trim() || info.data?.name || FALLBACK_BRAND_NAME,
        logoUrl: branding.data?.primaryLogoUrl ?? FALLBACK_BRAND_LOGO_URL,
        restaurantPhone: info.data?.phone ?? null,
        restaurantEmail: info.data?.email ?? null,
        restaurantAddress: address || null,
      });
    } catch {
      toast.error("Couldn't open the print dialog. The sale is saved — you can try printing again.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={printing}
      onClick={() => void handlePrint()}
    >
      {printing ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
