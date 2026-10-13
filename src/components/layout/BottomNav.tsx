import { Link } from "@tanstack/react-router";
import { Home, Phone, ReceiptText, Tag, User } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Persistent mobile bottom navigation for the customer-facing pages.
 * Reuses existing routes only — no new backend functionality.
 */
const ITEMS = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/contact", label: "Contact", icon: Phone, exact: false },
  { to: "/account/orders", label: "My Orders", icon: ReceiptText, exact: false },
  { to: "/account", label: "Account", icon: User, exact: true },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end">
        {ITEMS.slice(0, 2).map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <li className="flex justify-center">
          <Link
            to="/offers"
            aria-label="Offers"
            className="-mt-6 flex flex-col items-center gap-1"
          >
            <span className="grid size-14 place-items-center rounded-full bg-gradient-ember text-primary-foreground shadow-ember">
              <Tag aria-hidden="true" className="size-6" />
            </span>
            <span className="pb-1 text-[11px] font-semibold">Offers</span>
          </Link>
        </li>

        {ITEMS.slice(2).map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </ul>
    </nav>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  exact,
}: {
  to: (typeof ITEMS)[number]["to"];
  label: string;
  icon: typeof Home;
  exact: boolean;
}) {
  return (
    <li>
      <Link
        to={to}
        activeOptions={{ exact }}
        className={cn(
          "flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted-foreground",
        )}
        activeProps={{ className: "text-primary" }}
      >
        <Icon aria-hidden="true" className="size-5" />
        <span>{label}</span>
      </Link>
    </li>
  );
}

export function BottomNavSpacer() {
  return <div aria-hidden="true" className="h-16 md:h-0" />;
}
