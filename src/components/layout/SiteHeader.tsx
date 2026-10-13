import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { BrandLogo } from "@/components/branding/BrandLogo";
import { LocationSelector, useCustomerLocation } from "@/components/layout/LocationSelector";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { SearchOverlay } from "@/components/search/SearchOverlay";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useSavedAddresses } from "@/hooks/use-saved-addresses";

const navItems = [
  { to: "/", label: "Home" },
  { to: "/menu", label: "Menu" },
  { to: "/combos", label: "Combos" },
  { to: "/offers", label: "Offers" },
  { to: "/contact", label: "Contact" },
] as const;

export function SiteHeader() {
  const { isAuthenticated, loading } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const { location, setLocation } = useCustomerLocation();
  const { addresses } = useSavedAddresses();
  const savedAddress = isAuthenticated
    ? (addresses.find((a) => a.isDefault) ?? addresses[0] ?? null)
    : null;
  const savedLabel = savedAddress
    ? savedAddress.area?.trim() || savedAddress.label?.trim() || savedAddress.addressLine
    : null;

  return (
    <>
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-3 sm:px-6">
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2" aria-label="Flamio home">
          <BrandLogo variant="icon" showName textClassName="hidden text-xl uppercase tracking-wide sm:block" imageClassName="size-12 shadow-none" />
        </Link>

        <LocationSelector location={location} onSelect={setLocation} savedLabel={savedLabel} />

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-smooth hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "text-foreground bg-secondary" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search the menu"
            onClick={() => setSearchOpen(true)}
          >
            <Search aria-hidden="true" />
          </Button>

          {!loading && isAuthenticated ? <NotificationBell /> : null}
        </div>
      </div>
    </header>
    <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
