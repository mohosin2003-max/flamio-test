# Plan: Order management clarity and fast actions

## What exists
- Owner Orders already loads the latest orders, customer details, unread order-message counts, rider assignments, and the existing forward-only status actions.
- Kitchen already has its own permission-protected live queue, 20-second refresh, new-order alert, food lines, customer notes, and status update action.
- The shared status flow already enforces delivery and pickup progression; the server and database reject skipped or backward transitions.
- Customer order details and tracking already use the same saved order, timeline, item, address, payment, and messaging data.
- Owner, staff, and kitchen access is already enforced server-side through existing roles and granular permissions. No schema or RLS change is required.
- Existing order items contain name, quantity, variant, price, image, and combo labels. There is no separate add-on or item-instruction field, so the UI will not invent one; the existing order-level delivery note remains the customer note.

## Changes
1. **Shared staff order detail presentation**
   - Add small reusable presentation components for order summary, customer note, scannable food items, and the primary/secondary action area.
   - Reuse existing image URLs, status labels, money/date formatting, buttons, messaging, and rider controls.

2. **Owner Orders**
   - Keep each order collapsed initially as a compact card showing order number, customer name and phone, separate date/time, delivery or pickup, shortened address, total, and current status.
   - Replace the crowded card actions with one clear “View Order” control.
   - Open full details inline in the existing Orders screen, ordered as Summary → Customer Note when present → Order Items → Actions.
   - Keep Call Customer, order messaging, rider assignment, cancellation confirmation, and the existing next-status action only inside the expanded detail.
   - Make the immediate next status the dominant touch action, especially READY; keep call, message, rider, and cancel visually secondary.

3. **Kitchen / KDS**
   - Keep the live queue, alert, polling, inventory section, and permission checks unchanged.
   - Make each kitchen order easy to scan with order number/time/status, visible customer note when present, item images where available, quantities, variants/combo labels, and one large existing next-step action.
   - Keep kitchen focused on preparation; do not add owner-only contact, cancellation, or rider controls.

4. **Data reuse only**
   - Extend the existing Owner and Kitchen order reads only with fields already stored in `orders` and `order_items`, including note, image, price, and combo label.
   - Do not change tables, RLS, pricing, delivery fees, payment, authentication, inventory consumption, or status rules.

## Verification
- Run the available TypeScript check directly because the project has no `typecheck` script, then run the existing production build.
- Verify Owner Orders: compact card, detail expansion, note visibility, items, call/message/rider/cancel controls, and each next-status action.
- Verify Kitchen: queue readability, food details, note handling, large READY action, and status refresh behavior.
- Check phone and tablet widths for large touch targets, no clipped text, and no horizontal scrolling.
- Confirm customer order details/tracking remain unchanged and existing permissions still block unauthorized actions.