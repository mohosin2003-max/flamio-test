import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatBDT } from "@/lib/format";
import { displayPrice, menuQueryOptions, primaryImage } from "@/lib/menu-repository";
import type { Category, Product } from "@/types/menu";

/**
 * Customer-facing smart search overlay. Reads the EXISTING menu query
 * (`menuQueryOptions`) — no new data source, no search backend. Results link
 * into the existing product detail route.
 */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const menu = useQuery({ ...menuQueryOptions(), enabled: open });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const categoryById = useMemo(
    () => new Map((menu.data?.categories ?? []).map((c) => [c.id, c] as const)),
    [menu.data],
  );

  const results = useMemo(
    () => rankProducts(query, menu.data?.products ?? [], categoryById),
    [query, menu.data, categoryById],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-3">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search burgers, pizza, shawarma…"
            aria-label="Search the menu"
            className="w-full rounded-full border border-border bg-secondary py-2.5 pl-10 pr-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {!query ? (
          <CategoryChips categories={menu.data?.categories ?? []} onNavigate={onClose} />
        ) : results.length === 0 ? (
          <div className="space-y-5 py-8 text-center">
            <p className="font-display text-lg font-bold">No items found</p>
            <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
              Clear search
            </Button>
            <CategoryChips categories={menu.data?.categories ?? []} onNavigate={onClose} />
          </div>
        ) : (
          <ul className="mx-auto w-full max-w-3xl space-y-2">
            {results.map((product) => {
              const image = primaryImage(product);
              const category = categoryById.get(product.categoryId);
              return (
                <li key={product.id}>
                  <Link
                    to="/menu/$productSlug"
                    params={{ productSlug: product.slug }}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-2 transition-smooth hover:border-primary/50"
                  >
                    {image ? (
                      <img
                        src={image}
                        alt={product.name}
                        loading="lazy"
                        width={120}
                        height={120}
                        className="size-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="size-16 shrink-0 rounded-xl bg-muted" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{product.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {category?.name ?? ""}
                      </span>
                    </span>
                    <span className="font-display font-bold">
                      {formatBDT(displayPrice(product))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function CategoryChips({
  categories,
  onNavigate,
}: {
  categories: Category[];
  onNavigate: () => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Browse categories
      </p>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              to="/menu"
              search={{ category: c.slug }}
              onClick={onNavigate}
              className="inline-flex rounded-full border border-border bg-secondary px-4 py-2 text-sm font-medium"
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Exact name → starts-with → contains → category → description. */
function rankProducts(
  raw: string,
  products: Product[],
  categoryById: Map<string, Category>,
): Product[] {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ product: Product; score: number }> = [];

  for (const product of products) {
    const name = product.name.toLowerCase();
    const category = (categoryById.get(product.categoryId)?.name ?? "").toLowerCase();
    const description = (product.description ?? "").toLowerCase();
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    else if (category.includes(q)) score = 4;
    else if (description.includes(q)) score = 5;
    if (score >= 0) scored.push({ product, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 30)
    .map((s) => s.product);
}
