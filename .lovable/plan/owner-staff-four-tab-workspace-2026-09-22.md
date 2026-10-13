# Owner/Staff four-tab workspace

## Goal
Reorganize the existing Owner/Staff experience into one mobile-first workspace with exactly four primary destinations: **Home, Messages, Orders, Account**. Keep the customer app and its navigation unchanged, reuse all current business systems, and make no database changes.

## Implementation

### Shared Owner/Staff shell
- Replace the long dashboard tab strip with a persistent Owner/Staff bottom navigation: Home, Messages, Orders, Account.
- Show this shell only inside the Owner/Staff workspace; hide the customer header, footer, cart bar, and customer bottom navigation there.
- Keep all existing module URLs working so saved links and notifications remain valid.
- Keep all four positions stable. When Messages or Orders is not granted, present it as unavailable rather than exposing its route.
- Add unread customer-conversation count on Messages and active/incoming online-order count on Orders using the existing polling queries.

### Home
- Keep the current operational summaries.
- Replace the few current shortcuts with a clean permission-filtered module grid reusing existing routes.
- Prioritize Counter Sale, Kitchen, Orders, and Messages when granted, followed by inventory, purchases, suppliers, customers, challenges, rewards, delivery, riders, reports, staff, payroll, settings, and the remaining existing management modules.
- Counter Sale continues to use the existing internal POS route and order channel.

### Messages and Orders
- Keep `/owner/inbox` as the Messages destination and reuse the existing customer conversation functions, unread state, customer profile details, read handling, and reply UI.
- Improve unread conversation emphasis without changing message storage or behavior.
- Keep `/owner/orders` and the dedicated order-detail route as the Orders destination, reusing current order details, customer information, status actions, kitchen workflow, and order-message indicators.
- Permit order list/detail reads through either existing `online_orders` or `order_management` access; keep mutations protected by `order_management` Full Access.
- Direct Messages and Orders URLs remain blocked by the existing workspace gate and server checks when access is absent.

### Account
- Add one clear Owner/Staff Account landing screen using the existing signed-in profile, phone/email data, password-change flow, own salary/money pages, staff management, permission management, payroll, settings, and logout.
- Staff see only profile/contact details, password, their own permitted finance/access information, and logout.
- Owners see management/payroll/settings links in addition to their profile and logout.
- Do not expose customer orders, cart, addresses, favorites, vouchers, or customer rewards from this workspace.

### Role separation and security
- Redirect signed-in Owner/Staff users away from customer-facing home/menu/account surfaces into `/owner`, while leaving customer behavior unchanged.
- Hide customer chrome and cart affordances for Owner/Staff.
- Block both staff and owners from placing normal customer orders server-side; Counter Sale remains the sole staff/owner creation path.
- Preserve No Access, View Only, and Full Access behavior. Reuse current permission keys and server authorization; add no parallel permission system.

## Verification
- Run the project checks and inspect current diagnostics.
- Verify mobile and desktop Owner/Staff shell layouts and all four primary destinations.
- Verify permission-filtered Home cards, locked/no-access behavior, View Only order behavior, unread message count/read transition, active-order count, Account role-specific links, and Counter Sale routing.
- Verify signed-out protection and customer navigation remain unchanged.
- Verify direct customer cart/checkout/order creation is blocked for both Staff and Owner accounts at the server boundary.
