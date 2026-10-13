import { queryOptions } from "@tanstack/react-query";

import burgerImg from "@/assets/cat-burger.jpg";
import meatBoxImg from "@/assets/cat-meatbox.jpg";
import pastaImg from "@/assets/cat-pasta.jpg";
import pizzaImg from "@/assets/cat-pizza.jpg";
import shawarmaImg from "@/assets/cat-shawarma.jpg";
import { paymentMethods, promoBanners, restaurant } from "@/data/restaurant";
import { getPromoBanners } from "@/lib/banners.functions";
import { getMenu, getProductBySlug } from "@/lib/menu.functions";
import { getPublicRestaurantInfo } from "@/lib/restaurant.functions";
import type {
  Category,
  Product,
  ProductBadge,
  ProductImage,
  ProductVariant,
} from "@/types/menu";

/**
 * Single read layer for menu data. Reads the catalog from the database via the
 * public server functions in `menu.functions.ts`, then maps the rows to the
 * domain types the UI already consumes — so no component changes are needed.
 *
 * Real food photos aren't available yet, so `image_url` is seeded as NULL. The
 * bundled placeholder assets are applied here, keyed by category slug. When the
 * owner later uploads real photos and sets `image_url`, the fallback is skipped
 * automatically.
 */

type RawCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_visible: boolean;
  sort_order: number;
};

type RawProduct = {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price: number;
  is_available: boolean;
  is_featured: boolean;
  is_popular: boolean;
  badges: string[] | null;
  sort_order: number;
};

type RawVariant = {
  id: string;
  product_id: string;
  name: string;
  price: number;
  is_available: boolean;
  sort_order: number;
};

type RawImage = {
  id: string;
  product_id: string;
  url: string | null;
  alt: string;
  is_primary: boolean;
  sort_order: number;
};

export const placeholderByCategorySlug: Record<string, string> = {
  burger: burgerImg,
  "meat-box": meatBoxImg,
  pizza: pizzaImg,
  pasta: pastaImg,
  "shawarma-and-sides": shawarmaImg,
};

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function mapCategory(c: RawCategory): Category {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    imageUrl: c.image_url ?? placeholderByCategorySlug[c.slug] ?? null,
    isVisible: c.is_visible,
    sortOrder: c.sort_order,
  };
}

function mapVariant(v: RawVariant): ProductVariant {
  return {
    id: v.id,
    name: v.name,
    price: Number(v.price),
    isAvailable: v.is_available,
    sortOrder: v.sort_order,
  };
}

function mapImage(img: RawImage, placeholder: string): ProductImage {
  return {
    id: img.id,
    url: img.url ?? placeholder,
    alt: img.alt,
    isPrimary: img.is_primary,
  };
}

function mapProducts(args: {
  products: RawProduct[];
  variants: RawVariant[];
  images: RawImage[];
  catSlugById: Map<string, string>;
}): Product[] {
  const variantsByProduct = groupBy(args.variants, (v) => v.product_id);
  const imagesByProduct = groupBy(args.images, (i) => i.product_id);

  return args.products.map((p) => {
    const slug = args.catSlugById.get(p.category_id) ?? "burger";
    const placeholder = placeholderByCategorySlug[slug] ?? burgerImg;
    const rawImages = imagesByProduct.get(p.id) ?? [];
    const images: ProductImage[] = rawImages.length
      ? rawImages.map((img) => mapImage(img, placeholder))
      : [
          {
            id: `img_${p.id}`,
            url: placeholder,
            alt: `${p.name} at Flamio`,
            isPrimary: true,
          },
        ];

    return {
      id: p.id,
      slug: p.slug,
      categoryId: p.category_id,
      name: p.name,
      description: p.description,
      basePrice: Number(p.base_price),
      variants: (variantsByProduct.get(p.id) ?? []).map(mapVariant),
      images,
      badges: (p.badges ?? []) as ProductBadge[],
      isAvailable: p.is_available,
      isFeatured: p.is_featured,
      isPopular: p.is_popular,
      sortOrder: p.sort_order,
    } satisfies Product;
  });
}

export const menuQueryOptions = () =>
  queryOptions({
    queryKey: ["menu"],
    queryFn: async () => {
      const raw = await getMenu();
      const categories = raw.categories.map(mapCategory).sort((a, b) => a.sortOrder - b.sortOrder);
      const catSlugById = new Map(raw.categories.map((c) => [c.id, c.slug] as const));
      const products = mapProducts({
        products: raw.products,
        variants: raw.variants,
        images: raw.images,
        catSlugById,
      }).sort((a, b) => a.sortOrder - b.sortOrder);
      return { categories, products };
    },
    staleTime: 5 * 60 * 1000,
  });

export const productQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: ["product", slug],
    queryFn: async () => {
      const raw = await getProductBySlug({ data: { slug } });
      if (!raw.product || !raw.category) {
        return { product: null, category: null, related: [] as Product[] };
      }
      const catSlugById = new Map([[raw.category.id, raw.category.slug] as const]);
      const product = mapProducts({
        products: [raw.product],
        variants: raw.variants,
        images: raw.images,
        catSlugById,
      })[0] ?? null;
      const related = mapProducts({
        products: raw.related,
        variants: [],
        images: raw.relatedImages,
        catSlugById,
      });
      return { product, category: mapCategory(raw.category), related };
    },
    staleTime: 5 * 60 * 1000,
  });

export const restaurantQueryOptions = () =>
  queryOptions({
    queryKey: ["restaurant"],
    queryFn: async () => {
      // Owner-managed banners; falls back to the seed list (empty) on failure,
      // which keeps the existing "no promotions" behaviour.
      const [stored, liveRestaurant] = await Promise.all([
        getPromoBanners().catch(() => promoBanners),
        getPublicRestaurantInfo().catch(() => null),
      ]);
      return {
        restaurant: liveRestaurant
          ? {
              ...restaurant,
              name: liveRestaurant.name,
              tagline: liveRestaurant.tagline ?? restaurant.tagline,
              addressLine: liveRestaurant.addressLine ?? restaurant.addressLine,
              city: liveRestaurant.city ?? restaurant.city,
              country: liveRestaurant.country ?? restaurant.country,
              phone: liveRestaurant.phone,
              email: liveRestaurant.email,
              facebookUrl: liveRestaurant.facebookUrl,
              instagramUrl: liveRestaurant.instagramUrl,
              googleMapsUrl: liveRestaurant.googleMapsUrl,
            }
          : restaurant,
        banners: [...stored]
          .filter((b) => b.isActive)
          .sort((a, b) => a.sortOrder - b.sortOrder),
        paymentMethods,
        /** Raw public restaurant info, reused by sections that need extra fields. */
        info: liveRestaurant,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

/** Lowest sellable price for a product (base price or cheapest variant). */
export function displayPrice(product: Product): number {
  const enabled = product.variants.filter((v) => v.isAvailable);
  if (enabled.length === 0) return product.basePrice;
  return Math.min(...enabled.map((v) => v.price));
}

export function hasVariants(product: Product): boolean {
  return product.variants.some((v) => v.isAvailable);
}

export function primaryImage(product: Product): string | null {
  return (product.images.find((i) => i.isPrimary) ?? product.images[0])?.url ?? null;
}
