import { useNavigate } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { toast } from "sonner";

import { useFavorites } from "@/hooks/use-favorites";
import { cn } from "@/lib/utils";

/**
 * Heart control backed by the database-backed favorites table.
 * Guests are invited to sign in instead of writing anything locally.
 */
export function FavoriteButton({
  productId,
  productSlug,
  productName,
  className,
  size = "icon",
}: {
  productId: string;
  productSlug: string;
  productName: string;
  className?: string;
  size?: "icon" | "inline";
}) {
  const navigate = useNavigate();
  const { isAuthenticated, isFavorite, toggle, isPending } = useFavorites();
  const active = isAuthenticated && isFavorite(productId);

  async function handleClick() {
    if (!isAuthenticated) {
      toast.info("Sign in to save your favorites.");
      await navigate({ to: "/auth" });
      return;
    }
    try {
      await toggle(productId, productSlug);
      toast.success(active ? `Removed ${productName} from favorites` : `Saved ${productName}`);
    } catch {
      toast.error("We couldn't update your favorites. Please try again.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={active}
      aria-label={active ? `Remove ${productName} from favorites` : `Save ${productName} to favorites`}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border border-border/70 bg-background/85 text-muted-foreground backdrop-blur transition-smooth hover:text-primary disabled:opacity-60",
        size === "icon" ? "size-9" : "h-11 px-4 text-sm font-semibold",
        active && "border-primary/60 text-primary",
        className,
      )}
    >
      <Heart aria-hidden="true" className={cn("size-4", active && "fill-current")} />
      {size === "inline" ? <span>{active ? "Saved" : "Save"}</span> : null}
    </button>
  );
}
