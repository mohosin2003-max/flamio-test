# Compact Flamio Contact and Dashboard

## Goal
Keep Flamio’s current Home, navigation, dashboard, branding, and business systems intact while adding the requested configurable Contact Center, one real customer inbox, and compact owner-dashboard summaries.

## Changes

### Home and Contact Center
- Keep the existing `Find Flamio` section as the final Home content block, after the full menu and offers; preserve its current content and styling.
- Keep the existing bottom-navigation Contact destination (`/contact`) unchanged.
- Replace only the Contact page body with six compact actions in the existing dark/orange style: Call Restaurant, Call Owner, Customer Message / Inbox, Facebook Page, Messenger, and WhatsApp.
- Add independent owner switches for all six actions plus only the missing values: owner phone, Messenger URL, and WhatsApp number/link. Reuse the restaurant phone, Facebook page name/URL, and current restaurant-settings record.
- Hide disabled actions. Show `Not configured yet` for an enabled action without its required value. Never add placeholder contact data.

### Real customer inbox
- Keep the current per-order messaging unchanged; it serves a different, order-specific purpose and will not be copied or altered.
- Add the minimum general-contact storage: one conversation per signed-in customer and its text-message history. No demo rows.
- Add a protected customer Inbox screen where the customer can open or continue their single Flamio conversation and send text.
- Add an Owner Inbox screen, using the existing Customers permission, with conversation list, unread count, history, and replies.
- Enforce ownership and staff permission on the server and with row-level database rules; customers can read/write only their own conversation, while authorized dashboard users use protected server actions.
- Reuse the existing notification system to create an in-app/push alert for the recipient when a message is sent, without creating another notification system.

### Owner settings
- Add a compact Contact Center settings block to the existing Owner Settings form.
- Extend the existing restaurant-settings read/save functions and public reader; keep Payments, SMS/OTP, notification settings, and every unrelated setting untouched.

### Dashboard summaries
- Keep the existing dashboard home, push control, and quick links.
- Add permission-aware, compact clickable sections:
  - **Today:** completed sales amount, today’s order/customer count, purchase/other-expense total, and approved staff money activity.
  - **Operations:** active online-order count plus inventory totals, low-stock count, and out-of-stock count.
  - **Report summary:** completed sales, purchase expenses, and net through today.
- Read the existing orders, purchases, inventory, and staff-ledger tables. Reuse the Reports paid-sales rule (`completed` orders) and approved-ledger rule; do not create summary tables or new finance calculations.
- Make the existing Reports response/page include its missing purchase-expense and net figures so the dashboard and Reports visibly share one calculation source.
- Add optional date/search filters to the existing Orders, Purchases, Staff Accounts, and Reports pages only where needed so each card opens the correct detailed records. Inventory opens the existing Inventory page unchanged.
- Show cards only when the signed-in dashboard user has the corresponding module permission; owner access remains unrestricted.

## Database changes
- Add nullable contact values and six boolean visibility switches to the existing `restaurant_settings` row.
- Add `customer_conversations` and `customer_conversation_messages` only because the current `order_messages` table requires an order and cannot safely represent general contact threads.
- Add grants, indexes, uniqueness, timestamps, and row-level policies in the same additive migration. Preserve every existing row and table.

## Verification
- Confirm Home ordering and Contact rendering at mobile width.
- Confirm all six contact options: enabled/configured, enabled/missing, and disabled behavior.
- Confirm customer send/history/continue flow, owner unread/reply flow, recipient notification, and cross-customer denial.
- Confirm each dashboard figure against its existing detailed source and each card destination/filter.
- Confirm Reports and dashboard use matching sales, expense, and net totals.
- Confirm Payments, checkout, existing order messaging, and Owner Settings still render unchanged.
- Run focused tests, typecheck, production build, and inspect current diagnostics before reporting only verified results.

## Technical detail
- “Today” uses the restaurant’s Bangladesh business day (`Asia/Dhaka`) consistently on the server and in detail-page filters.
- New authenticated calls use the existing bearer middleware. Privileged dashboard reads re-check current permissions server-side; no client-only access decisions are treated as security.
