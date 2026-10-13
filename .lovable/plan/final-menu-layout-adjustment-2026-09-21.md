# Final menu layout adjustment

## Changes
- Keep the existing Home banner unchanged.
- Place the existing winner ticker immediately below it, linking announcements and the empty-state invitation to the existing Challenges page.
- Move the compact recommendation strip above the existing category navigation.
- Keep one owner-controlled Popular & Offers section below categories.
- Follow it immediately with “Explore the Full Menu” and every available product in the original category order.
- Allow recommendations and featured products to repeat in the complete menu, while keeping each featured item unique within Popular & Offers.
- Remove only the redundant separate Offers banner block from this menu sequence; the primary banner remains unchanged.

## Verification
- Check desktop and phone layouts for exact section order and horizontal overflow.
- Confirm winner links, category links, product links, and full product coverage.
- Confirm the preview build succeeds.

## Technical details
- Reuse `HomeCarousel`, `WinnerTicker`, `RecommendedSection`, `FeaturedSection`, `ProductCard`, and current menu/recommendation/challenge data.
- Make the winner feed safe for the public Home page while returning display names, game names/slugs, and prizes only.
- No schema, owner-control, product-data, pricing, cart, search, reward, or game-rule changes.
