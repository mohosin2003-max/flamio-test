import type { PaymentMethod, PromoBanner, Restaurant } from "@/types/menu";

/**
 * Seed data for the restaurant profile. Every field here is designed to be
 * owner-editable later. Fields that the owner has not provided are `null`
 * and must render as "not added yet" — never invented.
 */
export const restaurant: Restaurant = {
  id: "flamio",
  name: "Flamio",
  tagline: "Flame-grilled. Freshly built. Seriously good.",
  about:
    "Flamio is a flame-grilled kitchen in Kishoreganj serving burgers, meat boxes, stone-baked pizza, pasta and shawarma. Every order is cooked when you place it.",
  addressLine: "Kishoreganj Sadar, Gurudayal College",
  city: "Kishoreganj",
  country: "Bangladesh",
  phone: null,
  email: null,
  facebookUrl: null,
  instagramUrl: null,
  googleMapsUrl: null,
  openingHours: [
    { day: "Monday", opensAt: null, closesAt: null },
    { day: "Tuesday", opensAt: null, closesAt: null },
    { day: "Wednesday", opensAt: null, closesAt: null },
    { day: "Thursday", opensAt: null, closesAt: null },
    { day: "Friday", opensAt: null, closesAt: null },
    { day: "Saturday", opensAt: null, closesAt: null },
    { day: "Sunday", opensAt: null, closesAt: null },
  ],
  currency: "BDT",
};

/**
 * Homepage promotional banners. Owner Dashboard will manage this list.
 * Empty by design: no promotions have been provided yet.
 */
export const promoBanners: PromoBanner[] = [];

export const paymentMethods: PaymentMethod[] = [
  {
    id: "cash_on_delivery",
    label: "Cash on Delivery",
    description: "Pay with cash when your order arrives.",
    isEnabled: true,
  },
  {
    id: "online_payment",
    label: "Online Payment",
    description: "Coming soon.",
    isEnabled: false,
  },
];
