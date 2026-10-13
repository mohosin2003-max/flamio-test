import type { PromoBanner } from "@/types/menu";

/**
 * Promotional banner area. Content comes from data (future Owner Dashboard).
 * When no promotions exist, nothing is invented — the slot stays empty.
 */
export function PromoBannerArea({ banners }: { banners: PromoBanner[] }) {
  if (banners.length === 0) return null;

  return (
    <section aria-label="Promotions" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="grid gap-4 md:grid-cols-2">
        {banners.map((banner) => {
          const content = banner.desktopImageUrl ? (
            <picture className="block aspect-[4/3] w-full sm:aspect-[16/6]">
              {banner.mobileImageUrl ? <source media="(max-width: 639px)" srcSet={banner.mobileImageUrl} /> : null}
              <img src={banner.desktopImageUrl} alt="Promotional banner" loading="lazy" className="size-full object-cover" />
            </picture>
          ) : (
            <article className="bg-gradient-ember p-6 text-primary-foreground">
              <h3 className="font-display text-xl font-extrabold">{banner.title}</h3>
              {banner.subtitle ? <p className="mt-2 text-sm">{banner.subtitle}</p> : null}
            </article>
          );
          return (
            <div key={banner.id} className="overflow-hidden rounded-2xl border border-primary/30 shadow-ember">
              {banner.ctaHref ? <a href={banner.ctaHref} aria-label="Open promotion">{content}</a> : content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
