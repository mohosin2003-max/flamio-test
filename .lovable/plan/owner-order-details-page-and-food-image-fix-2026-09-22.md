# Owner Order Details Page and Food Image Fix

## Scope
Keep the current compact Owner order cards and Kitchen workflow. Add one dedicated Owner order-details page and correct only the existing ordered-item image display. No database, permission, status, pricing, delivery, payment, inventory, rider, polling, or authentication changes.

## Implementation
1. Add a nested Owner route at `/owner/orders/$orderId`, protected by the existing Owner dashboard gate and `online_orders` permission.
2. Add a focused server read for one order using the same server-side permission check as Owner Orders. Return all already-stored order data: identity/status/time, customer and delivery/pickup details, note, items, totals, coupon, payment fields, and rider details.
3. Move the existing expanded Owner presentation and actions into reusable order-detail components. The dedicated page will preserve the current status update, rider assignment, call, message, unread state, and confirmed cancellation behavior.
4. Keep Owner Orders compact. Make both the card/preview area and its existing **View Order** control link to the same typed detail route; remove the inline expanded details so there is only one staff detail presentation.
5. On the dedicated page, render the existing information in this order: summary, Customer Note only when present, ordered items, totals/payment/rider information, then existing actions and messages.
6. Preserve each stored `order_items.image_url`. When that snapshot is missing, resolve the product’s current primary image from the existing menu image records; otherwise show the current clean fallback. Apply the same fallback lookup to Owner and Kitchen reads.
7. Increase ordered-food thumbnails to a clear responsive aspect-ratio frame and handle failed image URLs by switching to the existing fallback icon, without changing storage or menu data.
8. Update existing owner-order notification links, if needed, to open the same dedicated page while preserving message focus behavior.

## Verification
- Run TypeScript checking and confirm the latest production build succeeds.
- Verify typed navigation from **View Order** and from the clickable card opens the matching order ID.
- Verify Customer Note omission/presence, full totals/payment/rider details, visible image/fallback states, and no horizontal overflow on phone, tablet, and desktop.
- Verify existing action handlers and permission checks remain unchanged; exercise authenticated Owner actions where an external session is available.
- Verify Kitchen polling and status controls remain unchanged while food images render consistently.
