import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, ShoppingBag } from "lucide-react";

import { useCart } from "@/context/cart";
import { formatBDT } from "@/lib/format";
import { cn } from "@/lib/utils";

const HIDDEN_ROUTES = ["/cart", "/checkout"];

export function FloatingCartBar() {
  const { itemCount, total, isHydrated } = useCart();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hidden = HIDDEN_ROUTES.some((r) => pathname.startsWith(r));
  const visible = isHydrated && itemCount > 0 && !hidden;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-16 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-smooth md:inset-x-auto md:right-6 md:bottom-6 md:px-0",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
      )}
    >
      <Link
        to="/cart"
        tabIndex={visible ? 0 : -1}
        aria-label={`View cart, ${itemCount} items, total ${formatBDT(total)}`}
        className={cn(
          "group flex w-full max-w-md items-center gap-3 rounded-2xl border border-primary/30 bg-card/95 p-2 pl-4 shadow-ember backdrop-blur-xl transition-smooth hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-auto md:min-w-[19rem]",
          visible && "pointer-events-auto",
        )}
      >
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-ember text-primary-foreground">
          <ShoppingBag aria-hidden="true" className="size-5" />
          <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full border border-card bg-foreground px-1 text-[11px] font-bold text-background">
            {itemCount}
          </span>
        </span>

        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {itemCount} {itemCount === 1 ? "item" : "items"} in cart
          </span>
          <span className="font-display text-lg font-extrabold text-foreground">
            {formatBDT(total)}
          </span>
        </span>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-ember px-4 py-2.5 text-sm font-bold text-primary-foreground transition-smooth group-hover:brightness-110">
          View cart
          <ArrowRight aria-hidden="true" className="size-4" />
        </span>
      </Link>
    </div>
  );
}

export function FloatingCartSpacer() {
  const { itemCount, isHydrated } = useCart();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visible = isHydrated && itemCount > 0 && !HIDDEN_ROUTES.some((r) => pathname.startsWith(r));
  return <div aria-hidden="true" className={cn(visible ? "h-24 md:h-0" : "h-0")} />;
}
