# Flamio Account, Rewards, and Contact

## Scope
- Preserve the existing logo, location selector, search, notifications, authentication, checkout, ordering, menu, and bottom navigation.
- Remove only the header’s three-dot menu.
- Rebuild only the Account content to follow the uploaded reference: profile cover, left-aligned circular photo, customer details, edit action, centered brand line, compact rewards banner, five service shortcuts, and logout.
- Keep existing Orders, Addresses, Favorites, and coupon functionality as the destinations behind the new Account shortcuts.
- Simplify Contact to Location, Opening Hours, and Call/Contact only.

## Profile photo
- Extend the existing customer profile rather than creating another profile system.
- Add one private profile-photo storage area with customer-only upload/update/delete permissions.
- Store only the image path on the existing profile record; serve the signed image securely.
- Put upload/change controls inside the existing profile edit area so Account does not duplicate settings.

## Rewards
- Add one rewards feature because no suitable reward schema or logic currently exists.
- Create reward rules, customer reward transactions, and manual claims with explicit grants and row-level access controls.
- Use an immutable points ledger; calculate balances from approved transactions.
- Prevent duplicate rewards with a unique action reference, including one completed-order reward per order.
- Award enabled completed-order points when an order first reaches completed status.
- Let customers submit eligible manual claims for referral, social/brand promotion, review, challenge, or future actions; owner approval creates the reward once.
- Add a customer Rewards page with balance, earning and redemption guidance, and history/status.
- Add Owner → Rewards controls for enabling actions, setting point values, and reviewing manual claims.

## Vouchers
- Add a customer Vouchers page that reads the existing active coupons; do not create a second voucher or discount system.

## Verification
- Validate type safety and the production build.
- Test mobile Account, profile editing/photo flow, Rewards, Vouchers, existing Orders/Addresses/Favorites, compact Contact, authentication persistence, and unchanged bottom navigation.
