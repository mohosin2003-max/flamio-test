import burgerImg from "@/assets/cat-burger.jpg";
import meatBoxImg from "@/assets/cat-meatbox.jpg";
import pizzaImg from "@/assets/cat-pizza.jpg";
import pastaImg from "@/assets/cat-pasta.jpg";
import shawarmaImg from "@/assets/cat-shawarma.jpg";
import type { Category, Product, ProductBadge } from "@/types/menu";

/**
 * Seed menu data. Structured exactly like the future database rows so the
 * Owner Dashboard can add / edit / hide / reorder categories and products.
 * Images are placeholders per category and can be replaced per product later.
 */

export const categories: Category[] = [
  {
    id: "cat_burger",
    slug: "burger",
    name: "Burger",
    description: "Flame-grilled patties in soft toasted buns.",
    imageUrl: burgerImg,
    isVisible: true,
    sortOrder: 1,
  },
  {
    id: "cat_meat_box",
    slug: "meat-box",
    name: "Meat Box",
    description: "Loaded boxes built for real hunger.",
    imageUrl: meatBoxImg,
    isVisible: true,
    sortOrder: 2,
  },
  {
    id: "cat_pizza",
    slug: "pizza",
    name: "Pizza",
    description: "Stone-baked, generously topped.",
    imageUrl: pizzaImg,
    isVisible: true,
    sortOrder: 3,
  },
  {
    id: "cat_pasta",
    slug: "pasta",
    name: "Pasta",
    description: "Oven baked and cheesy.",
    imageUrl: pastaImg,
    isVisible: true,
    sortOrder: 4,
  },
  {
    id: "cat_shawarma_sides",
    slug: "shawarma-and-sides",
    name: "Shawarma & Sides",
    description: "Wraps, wings and crunchy sides.",
    imageUrl: shawarmaImg,
    isVisible: true,
    sortOrder: 5,
  },
];

const imageByCategory: Record<string, string> = {
  cat_burger: burgerImg,
  cat_meat_box: meatBoxImg,
  cat_pizza: pizzaImg,
  cat_pasta: pastaImg,
  cat_shawarma_sides: shawarmaImg,
};

interface SeedProduct {
  name: string;
  price: number;
  badges?: ProductBadge[];
  featured?: boolean;
  popular?: boolean;
}

const seed: Record<string, SeedProduct[]> = {
  cat_burger: [
    { name: "Flamio Classic Burger", price: 60, popular: true },
    { name: "Naga Fire Burger", price: 70, badges: ["spicy"] },
    { name: "Crispy Chicken Burger", price: 70, popular: true },
    { name: "Cheesy Blast Burger", price: 90 },
    { name: "Flamio Special Burger", price: 99, featured: true, popular: true },
    { name: "Crispy Cheese Crunch", price: 110 },
    { name: "BBQ Cheese Burst Burger", price: 120, featured: true },
  ],
  cat_meat_box: [
    { name: "Mini Meat Box", price: 99, popular: true },
    { name: "Mini Naga Meat Box", price: 120, badges: ["spicy"] },
    { name: "BBQ Meat Box", price: 120 },
    { name: "Regular Meat Box", price: 150 },
    { name: "Flamio Special Meat Box", price: 199, featured: true, popular: true },
    { name: "Full Chicken Meat Box", price: 250 },
  ],
  cat_pizza: [
    { name: "Italian Margherita Classica", price: 200, popular: true },
    { name: "Savory Sausage", price: 250 },
    { name: "BBQ Chicken Supreme", price: 280, featured: true, popular: true },
    { name: "Meat Lovers Deluxe", price: 300 },
    { name: "Pepperoni Blast", price: 330 },
    { name: "Italiano Flamio Special", price: 400, featured: true },
  ],
  cat_pasta: [{ name: "Oven Baked Pasta", price: 150, popular: true }],
  cat_shawarma_sides: [
    { name: "Chicken Shawarma", price: 99, featured: true, popular: true },
    { name: "Nachos", price: 110 },
    { name: "BBQ Wings (4 Pcs)", price: 140, popular: true },
    { name: "Chicken Lollipop (6 Pcs)", price: 140 },
  ],
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const products: Product[] = Object.entries(seed).flatMap(([categoryId, items]) =>
  items.map((item, index) => {
    const slug = slugify(item.name);
    const image = imageByCategory[categoryId] ?? burgerImg;
    return {
      id: `prd_${slug}`,
      slug,
      categoryId,
      name: item.name,
      description: null,
      basePrice: item.price,
      // Variants are optional for every product, including pizza.
      // The owner can add sizes (6/8/10 inch) later without a data migration.
      variants: [],
      images: [
        {
          id: `img_${slug}`,
          url: image,
          alt: `${item.name} at Flamio`,
          isPrimary: true,
        },
      ],
      badges: item.badges ?? [],
      isAvailable: true,
      isFeatured: Boolean(item.featured),
      isPopular: Boolean(item.popular),
      sortOrder: index + 1,
    } satisfies Product;
  }),
);
