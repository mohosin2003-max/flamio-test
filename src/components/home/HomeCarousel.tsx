import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { formatBDT } from "@/lib/format";
import { displayPrice, primaryImage } from "@/lib/menu-repository";
import { cn } from "@/lib/utils";
import type { Product, PromoBanner } from "@/types/menu";

type Slide = {
  key: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  productSlug: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  mobileImage: string | null;
  imageOnly: boolean;
};

/**
 * Home promotional carousel. Uses ONLY existing data: owner promo banners when
 * present, otherwise existing featured/popular menu items. No invented content.
 */
export function HomeCarousel({
  banners,
  products,
}: {
  banners: PromoBanner[];
  products: Product[];
}) {
  const slides: Slide[] = banners.length
    ? banners.map((b) => ({
        key: b.id,
        title: b.title,
        subtitle: b.subtitle ?? null,
        image: b.desktopImageUrl,
        mobileImage: b.mobileImageUrl,
        imageOnly: Boolean(b.desktopImageUrl),
        productSlug: null,
        ctaLabel: b.ctaLabel ?? null,
        ctaHref: b.ctaHref ?? null,
      }))
    : products.slice(0, 5).map((p) => ({
        key: p.id,
        title: p.name,
        subtitle: p.description ?? `From ${formatBDT(displayPrice(p))}`,
        image: primaryImage(p),
        mobileImage: null,
        imageOnly: false,
        productSlug: p.slug,
        ctaLabel: null,
        ctaHref: null,
      }));

  const trackRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const id = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % slides.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, 5000);
    return () => clearInterval(id);
  }, [slides.length]);

  if (slides.length === 0) return null;

  return (
    <section aria-label="Promotions" className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
      <ul
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, slideIndex) => {
          const isFirst = slideIndex === 0;
          const body = (
            <div className="relative w-full overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
              {slide.imageOnly && slide.image ? (
                <picture className="block aspect-[4/3] w-full sm:aspect-[16/6]">
                  {slide.mobileImage ? <source media="(max-width: 639px)" srcSet={slide.mobileImage} /> : null}
                  <img
                    src={slide.image}
                    alt="Promotional banner"
                    loading={isFirst ? "eager" : "lazy"}
                    fetchPriority={isFirst ? "high" : "low"}
                    className="size-full object-cover"
                  />
                </picture>
              ) : slide.image ? (
                <img
                  src={slide.image}
                  alt={slide.title}
                  loading={isFirst ? "eager" : "lazy"}
                  fetchPriority={isFirst ? "high" : "low"}
                  className="h-44 w-full object-cover opacity-70 sm:h-64"
                />
              ) : (
                <div className="h-44 bg-gradient-ember opacity-90 sm:h-64" aria-hidden="true" />
              )}
              {!slide.imageOnly ? <div className="absolute inset-0" style={{ background: "var(--gradient-fade)" }} aria-hidden="true" /> : null}
              {!slide.imageOnly ? <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <h2 className="font-display text-xl font-extrabold sm:text-3xl">{slide.title}</h2>
                {slide.subtitle ? (
                  <p className="mt-1 line-clamp-2 max-w-lg text-sm text-muted-foreground sm:text-base">
                    {slide.subtitle}
                  </p>
                ) : null}
                {slide.ctaLabel && !slide.ctaHref ? (
                  <span className="mt-3 inline-block text-sm font-semibold">{slide.ctaLabel}</span>
                ) : null}
              </div> : null}
            </div>
          );

          return (
            <li key={slide.key} className="w-full shrink-0 snap-center">
              {slide.productSlug ? (
                <Link
                  to="/menu/$productSlug"
                  params={{ productSlug: slide.productSlug }}
                  aria-label={`View ${slide.title}`}
                >
                  {body}
                </Link>
              ) : slide.ctaHref ? (
                <a href={slide.ctaHref} aria-label="Open promotion">{body}</a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>

      {slides.length > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
          {slides.map((slide, i) => (
            <span
              key={slide.key}
              className={cn(
                "h-1.5 rounded-full transition-smooth",
                i === active ? "w-5 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
