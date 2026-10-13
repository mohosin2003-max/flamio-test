# Phase 1 — Smart Food Recommendation

## What the customer sees

A new "Recommended for You" block on the homepage, above the Popular row, in the existing Flamio card style (same product cards, same one-tap add-to-cart, same prices and options).

- **Order again** — items the customer actually ordered before in completed/delivered orders, most recent and most frequent first.
- **Try something new** — available items they haven't ordered, preferring the owner's featured/popular picks and the categories they already like.
- **Guests / no order history** — falls back to the owner's featured and popular items only. No invented popularity numbers.
- Sold-out or hidden items are never shown; prices and size options always come from today's live menu.
- When the owner switches the feature off, the block simply doesn't render — nothing empty or broken.

## Owner control

Inside the existing Owner Dashboard → Settings (no new screen):

- On/off switch: "Recommended for You".
- A number field for how many items to show (1–12).
- A short note that featured items are chosen in the existing Menu screen — the current "Featured" flag on a product is reused, so no duplicate item management.

## Technical notes

- Migration adds two columns to `restaurant_settings`: `recommendations_enabled boolean default true`, `recommendations_count int default 6`. No new tables.
- New `src/lib/recommendations.functions.ts` with one server function that returns `{ enabled, count, orderAgain: string[], tryNew: string[] }` — product IDs only, resolved against the existing `menuQueryOptions` on the client so availability, price and variants stay canonical.
- Caller identity via the existing `getOptionalUserId()` helper, so the same endpoint serves guests and signed-in customers; order history is read with the service client filtered to `user_id = caller` and `status in (completed, delivered)`. No other customer's data is ever read or returned.
- Extend the existing `RestaurantSettings` type, `ownerGetSettings`, `ownerUpdateSettings` and the settings form with the two fields.
- New presentation component `src/components/home/RecommendedSection.tsx` reusing `ProductCard`; rendered from `src/routes/index.tsx`.
- No changes to menu, orders, rewards, inventory, challenges, or existing data.

## Verification

Typecheck + build, then in the running app: signed-in customer with order history, a customer without history, a product marked unavailable, and the owner on/off switch.
