import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FavoriteButton } from "@/components/menu/FavoriteButton";
import { ProductCard } from "@/components/menu/ProductCard";
import { QuantityStepper } from "@/components/menu/QuantityStepper";
import { ProductReviews } from "@/components/reviews/ProductReviews";
import { Button } from "@/components/ui/button";

import { EmptyState } from "@/components/ui/states";
import { useCart } from "@/context/cart";
import { formatBDT } from "@/lib/format";
import { productQueryOptions } from "@/lib/menu-repository";
import { cn } from "@/lib/utils";
import type { ProductVariant } from "@/types/menu";

export const Route = createFileRoute("/menu/$productSlug")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(productQueryOptions(params.productSlug)),
  head: ({ loaderData }) => {
    const product = loaderData?.product;
    if (!product) {
      return {
        meta: [{ title: "Item unavailable — Flamio" }, { name: "robots", content: "noindex" }],
      };
    }
    const description = `${product.name} at Flamio — ${formatBDT(product.basePrice)}. Order online in Kishoreganj Sadar.`;
    return {
      meta: [
        { title: `${product.name} — Flamio` },
        { name: "description", content: description },
        { property: "og:title", content: `${product.name} — Flamio` },
        { property: "og:description", content: description },
      ],
    };
  },
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { productSlug } = Route.useParams();
  const { data } = useSuspenseQuery(productQueryOptions(productSlug));
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);

  if (!data.product) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          title="This dish isn't available"
          description="It may have been removed from the menu. Browse everything else we're cooking."
          action={
            <Button asChild>
              <Link to="/menu" search={{}}>
                Back to menu
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const product = data.product;
  const variants = product.variants.filter((v) => v.isAvailable);
  const selectedVariant: ProductVariant | null =
    variants.find((v) => v.id === variantId) ?? (variants.length > 0 ? variants[0]! : null);
  const unitPrice = selectedVariant?.price ?? product.basePrice;
  const image = product.images.find((i) => i.isPrimary) ?? product.images[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        to="/menu"
        search={{}}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-smooth hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to menu
      </Link>

      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
          {image ? (
            <img
              src={image.url}
              alt={image.alt}
              width={800}
              height={800}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="grid aspect-square place-items-center bg-muted text-muted-foreground">
              Image coming soon
            </div>
          )}
        </div>

        <div className="flex flex-col">
          {data.category ? (
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">
              {data.category.name}
            </span>
          ) : null}
          <h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">{product.name}</h1>
          <p className="mt-3 text-muted-foreground">
            {product.description ?? "A full description for this dish is coming soon."}
          </p>

          <p className="mt-5 font-display text-3xl font-extrabold text-gradient-ember">
            {formatBDT(unitPrice)}
          </p>

          {variants.length > 0 && (
            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Choose a size</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {variants.map((variant) => {
                  const active = selectedVariant?.id === variant.id;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => setVariantId(variant.id)}
                      aria-pressed={active}
                      className={cn(
                        "rounded-xl border px-4 py-2.5 text-sm font-medium transition-smooth",
                        active
                          ? "border-primary bg-secondary text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {variant.name} · {formatBDT(variant.price)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <QuantityStepper
              value={quantity}
              label={product.name}
              onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
              onIncrease={() => setQuantity((q) => Math.min(99, q + 1))}
            />
            <Button
              size="lg"
              className="flex-1 shadow-ember sm:flex-none"
              disabled={!product.isAvailable}
              onClick={() => {
                addItem(product, selectedVariant, quantity);
                toast.success(`${quantity} × ${product.name} added to cart`);
              }}
            >
              <ShoppingBag aria-hidden="true" />
              Add to cart · {formatBDT(unitPrice * quantity)}
            </Button>
            <FavoriteButton
              productId={product.id}
              productSlug={product.slug}
              productName={product.name}
              size="inline"
            />
          </div>

          <Button asChild variant="secondary" size="lg" className="mt-3">
            <Link to="/cart">Go to cart</Link>
          </Button>
        </div>
      </div>

      <ProductReviews productId={product.id} />

      {data.related.length > 0 && (

        <section aria-labelledby="related-heading" className="mt-16">
          <h2 id="related-heading" className="font-display text-2xl font-extrabold">
            You might also like
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
