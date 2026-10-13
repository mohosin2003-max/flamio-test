/**
 * Core domain types for Flamio Smart Restaurant OS.
 *
 * These shapes intentionally mirror a future relational backend
 * (restaurants, categories, products, product_variants, product_images,
 * banners, orders, order_items ...). All UI reads through the repository in
 * `src/lib/menu-repository.ts`, so swapping the local seed data for a real
 * database later requires no component changes.
 */

export type ID = string;

export interface Restaurant {
  id: ID;
  name: string;
  tagline: string;
  about: string;
  addressLine: string;
  city: string;
  country: string;
  /** Editable later from the Owner Dashboard. `null` = not provided yet. */
  phone: string | null;
  email: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  googleMapsUrl: string | null;
  /** Opening hours are a placeholder until the owner configures them. */
  openingHours: OpeningHour[];
  currency: "BDT";
}

export interface OpeningHour {
  day: string;
  /** `null` means "not configured yet" – never invent business data. */
  opensAt: string | null;
  closesAt: string | null;
}

export interface Category {
  id: ID;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Owner Dashboard: hide/show */
  isVisible: boolean;
  /** Owner Dashboard: reorder */
  sortOrder: number;
}

export interface ProductVariant {
  id: ID;
  /** e.g. "6 inch", "8 inch", "10 inch" */
  name: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ProductImage {
  id: ID;
  url: string;
  alt: string;
  isPrimary: boolean;
}

export type ProductBadge = "popular" | "new" | "spicy";

export interface Product {
  id: ID;
  slug: string;
  categoryId: ID;
  name: string;
  /** Placeholder copy until the owner writes real descriptions. */
  description: string | null;
  /** Base price. Used when the product has no variants. */
  basePrice: number;
  /** Optional – a product (including pizza) may have zero variants. */
  variants: ProductVariant[];
  images: ProductImage[];
  badges: ProductBadge[];
  isAvailable: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
}

export interface PromoBanner {
  id: ID;
  /** Owner Dashboard controlled. Empty list = no promotions running. */
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  /** Private storage paths are kept server-side; these are short-lived display URLs. */
  desktopImagePath: string | null;
  mobileImagePath: string | null;
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CartLine {
  /** Stable key: productId + variantId */
  lineId: string;
  productId: ID;
  productName: string;
  productSlug: string;
  variantId: ID | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  /**
   * Combo lines are ordinary product lines tagged with the combo they came
   * from, so orders, the kitchen list and stock counting stay unchanged. All
   * combo pricing and rules are re-checked server-side before an order is
   * accepted, so these fields are labels — never a source of truth.
   */
  comboId?: ID | null;
  comboName?: string | null;
  /** Groups the lines of one built combo together in the cart. */
  comboKey?: string | null;
  comboGroupId?: ID | null;
}

export type FulfillmentType = "delivery" | "pickup";
export type PaymentMethodId = "cash_on_delivery" | "online_payment";

export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  description: string;
  isEnabled: boolean;
}

/** Owner-editable delivery zone. All money values are in BDT. */
export interface DeliveryZone {
  id: ID;
  name: string;
  deliveryCharge: number;
  minimumOrder: number;
  /** `null` = no free-delivery threshold for this zone. */
  freeDeliveryThreshold: number | null;
  isFreeDeliveryEnabled: boolean;
  estimatedDeliveryTime: string | null;
  isActive: boolean;
  /** "area" = the existing named area the customer picks; "radius" = a
   * distance ring around the restaurant, matched automatically. */
  zoneType: "area" | "radius";
  /** Ring bounds in metres (radius zones only). */
  radiusMinM: number | null;
  radiusMaxM: number | null;
  /** Fee charged once the free-delivery threshold is reached. null/undefined
   * or 0 = free delivery (existing behaviour); > 0 = charge this instead. */
  reducedDeliveryFee?: number | null;
}

/** Global delivery configuration, owner-editable from a future dashboard. */
export interface DeliverySettings {
  isDeliveryEnabled: boolean;
  isPickupEnabled: boolean;
  defaultDeliveryCharge: number;
  defaultMinimumOrder: number;
  isFreeDeliveryEnabled: boolean;
  freeDeliveryThreshold: number | null;
  defaultEstimatedDeliveryTime: string | null;
  pickupNote: string | null;
  defaultZoneId: ID | null;
}

export interface DeliveryQuote {
  charge: number;
  isFree: boolean;
  freeReason: "pickup" | "threshold" | null;
  minimumOrder: number;
  meetsMinimumOrder: boolean;
  freeDeliveryThreshold: number | null;
  amountToFreeDelivery: number | null;
  estimatedTime: string | null;
}

/** Structured customer address – ready for saved-address management later. */
export interface CustomerAddress {
  id: ID;
  label: string | null;
  fullName: string;
  phone: string;
  addressLine: string;
  area: string | null;
  zoneId: ID | null;
  landmark: string | null;
  deliveryNotes: string | null;
  isDefault: boolean;
  /** Pinned map location, when the customer chose one. */
  latitude: number | null;
  longitude: number | null;
}

export interface CustomerLocation {
  label: string;
  latitude: number | null;
  longitude: number | null;
}

export interface CheckoutDraft {
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethodId;
  address: Omit<CustomerAddress, "id" | "isDefault" | "label">;
  discount: number;
}

