# Scheduled Pre-Orders + Automatic Open/Closed

## What I found
- Open/Closed today is a manual switch in Owner Settings; Opening/Closing times are only shown to customers. The app never enforces them, so orders and games work around the clock.
- There is no working online payment yet (bKash is set up for later only; checkout shows "Online Payment - Coming soon").
- Orders have one status (placed → confirmed → preparing → ready → out for delivery → completed / cancelled). The New Order alarm, staff phone alerts and Kitchen all react to "placed".

## Decisions needing your OK
1. **Database change (needs approval).** One SQL file, adding columns only, nothing removed:
   - restaurant settings: scheduled orders on/off, max advance days (3), payment required on/off, preparation minutes (30), slot interval (30), allow while closed on/off, and "open/closed follows hours" on/off.
   - orders: `scheduled_for` (date+time), `order_kind` (regular/scheduled), `payment_status`.
   - one new order status: `scheduled`.
   No security rules loosened; no other tables touched.
2. **Payment Required = ON cannot work yet**, because online payment doesn't exist. While ON, the server will refuse scheduled orders with "Online payment is required for scheduled orders and isn't available yet", and Owner Settings will show a warning. When bKash is built, it plugs into this same check. With it OFF, scheduled orders use Cash on Delivery like today.
3. **Manual Open/Closed switch stays** as an override ("Force closed"), so you can close early on a holiday. Automatic hours decide otherwise.

## How it will work
- **Open/Closed:** worked out from Opening/Closing time in Dhaka time, including hours that run past midnight. When closed: menu browsing stays; regular online orders are refused by the server; challenge play and reward claims are refused by the server and the play buttons show "Available when we're open". Kitchen, Owner Dashboard, Counter Sale, existing orders, rewards history untouched.
- **Open hours:** checkout exactly as now. A small "Schedule for later" link near the checkout Place Order area opens the date/time picker.
- **Closed + cart → Checkout:** one popup "We're Closed Right Now" with the Date selector, Time selector and "Continue to Checkout" all inside it. Then the normal Checkout, showing "Scheduled for Sun, Sep 28 · 10:30 AM" with a Change link. If scheduled orders are off, the popup just says we're closed and shows opening time.
- **Valid slots:** only dates within the advance window, only times inside opening hours on the chosen interval, earliest slot = now + preparation time. The server re-checks every rule.
- **Owner side:** new scheduled orders get status "Scheduled", no alarm, no phone alert, not in Kitchen. Orders page gets an "Upcoming" filter showing order number, customer, date, time, payment status, status.
- **Becoming due:** the existing once-a-minute background job moves scheduled orders to "placed" when scheduled time minus preparation time arrives. From there the existing New Order alarm, staff alerts, escalation and Kitchen take over unchanged.
- **Customer:** order page and history show "Scheduled for ..." and the status steps Scheduled → Preparing → Ready → Completed (or Cancelled). Owner can cancel a scheduled order; customers can't skip it ahead.

## Technical details
- `docs/sql/scheduled_orders.sql` (additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, status check/enum extended with `scheduled`), run only after approval; `types.ts` updated to match.
- New `src/lib/opening-hours.ts` (pure Dhaka-time helpers: isOpenNow, listSlots, validateSlot) shared by browser and server.
- `orders.functions.ts` placeOrder: online, not scheduled + closed → reject; scheduled → validate slot/window/payment rule, insert with status `scheduled`, skip queueing staff alert/escalation.
- `challenges`/`rewards` server functions: reject play/claim when closed.
- `api/public/notifications/dispatch.ts`: promote due scheduled orders, then queue the existing staff alert for them.
- `restaurant.functions.ts` / `owner.functions.ts` / `owner.settings.tsx`: new settings fields and a small "Scheduled Orders" section.
- `checkout.tsx`: closed popup + "Schedule for later" + scheduled line; slot kept in the existing pending-checkout state.
- `order-status.ts`, `owner.orders.index.tsx`, customer order pages: "Scheduled" label and Upcoming filter.
- Kitchen query and NewOrderAlarm already ignore non-"placed" orders — no change.
- Counter Sale unchanged.
