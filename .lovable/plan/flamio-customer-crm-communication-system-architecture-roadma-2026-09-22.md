# Flamio Customer CRM + Communication System — Architecture & Roadmap

Planning only. Nothing in this document has been built, no database or security rule changed.

## 1. What exists today (verified in code)

REUSE AS-IS
- Orders (registered + guest). Guest orders store name, phone, address, area, coordinates, notes; `user_id` empty.
- `profiles` (name, phone), Supabase Auth (email or phone login, OTP), phone-change flow with verification.
- `notifications` (in-app bell, per-user security rules), `push_tokens` (browser/PWA subscriptions), `notification_push_deliveries` (per-token sent/failed audit), `notification_jobs` + claim function + `/api/public/notifications/dispatch` (scheduled, claimed once), `public/sw.js` service worker, working Web Push with VAPID keys.
- SMS delivery layer `sms.server.ts` (provider sms.net.bd / Alpha SMS, key `ALPHA_SMS_API_KEY`, owner-managed provider row, send + balance). Today it is called only by the login-code hook — the sending function itself is reusable for customer SMS.
- Customer-initiated conversations (owner inbox), per-order messages, reviews, rewards, vouchers/coupons, addresses, favourites.
- Permission catalogue with per-person No access / View only / Full access, enforced server-side.

EXTEND
- `/owner/customers` (list grouped by phone text from orders, live segments, promo broadcast, one-customer notification).
- `/owner/inbox` (add owner-initiated threads).

MISSING ENTIRELY
- Customer profile page, search, notes, tags, communication history.
- Any identity record that joins a phone number to an account (guest linking).
- Consent / marketing opt-out, channel capability model, message router, delivery log, campaigns, templates, composer.
- Customer SMS, WhatsApp, email sending.

DO NOT TOUCH
- Auth, guest checkout, orders/POS/kitchen, Web Push internals, existing notifications, existing conversations and order messages, rewards, reviews, staff permission engine.

## 2. Customer identity

Introduce one CRM record per real person (`crm_customers`) with a separate table of identities (`crm_customer_identities`: kind = auth_user | phone | email, value, verified_at, source). Orders keep their own columns untouched; a nullable `crm_customer_id` on orders (backfilled by a server job) is the only join added.

Identity rules
- Registered customer: identity `auth_user` (always trusted) plus their verified account phone/email.
- Guest customer: identity `phone` marked unverified, created from order data.
- Guest → account linking: when someone signs up/logs in with a phone that Auth has verified by OTP, the system proposes a merge of the guest record holding the same normalised phone. Automatic merge only when: the phone is OTP-verified on the account, exactly one guest record matches, and that guest record is not already linked to another account. Otherwise it becomes a pending merge for owner confirmation (side-by-side orders, names, addresses; accept/reject; audit row). Phone matching alone is never sufficient — shared family phones and re-used numbers are real. Merges are recorded, never destructive: old order rows stay, only `crm_customer_id` points to the surviving record, and a merge can be undone from the audit trail.
- Multiple orders, same phone: one CRM record, many orders.
- Account without phone: identity `auth_user` only — reachable by in-app + push (+ email later), never by SMS until a phone is verified.

## 3. Customer profile page

`/owner/customers/$customerId`. Reuses existing data for: orders, totals, average order value, reviews, rewards, vouchers, addresses, favourites, notifications, conversations, order messages. Needs new storage for: customer type/segment cache, tags, internal notes, important dates (birthday), last contacted, preferred channel, consent flags.

## 4. Communication model

Five distinct concepts, never mixed, each with its own type on the message record:
- notification (in-app bell row)
- transactional (order/payment/security — always allowed)
- promotional (needs marketing consent)
- support (owner↔customer reply thread)
- chat (two-way conversation)

Channels: in-app, web push, SMS, WhatsApp (later), email (later).

Channel capability per customer, computed, shown as a traffic light:
- In-App: green if an auth account exists.
- Push: green if ≥1 active push token, amber if account but no token, red otherwise.
- SMS: green if a verified phone + SMS provider enabled + credit; amber if unverified phone; red if no phone.
- WhatsApp: green only when a WhatsApp Business API provider is connected and the number opted in; otherwise amber (manual wa.me link, which already exists) or red.
- Email: green only when an email exists and an email sender is configured; today red.
- Marketing allowed only when consent flag is true and channel is capable.

## 5. Owner-initiated chat

Add "Start conversation" to the profile: a server function creates (or reuses) the existing conversation row with `started_by = staff`, then writes a message through the existing send path. The customer's existing inbox renders it with no change; existing customer-initiated flow untouched. Only available for accounts (chat needs a login). For guests, the composer offers SMS/WhatsApp instead.

## 6. Guest communication workflow

Guest with phone only → normalise phone → capability check (provider enabled, key present, credit, phone verified-or-owner-override) → transactional SMS through the existing SMS layer → log delivery. If the provider is not configured, the composer disables SMS and explains why rather than pretending to send. WhatsApp path requires a Business API provider + template approval + opt-in; until then the profile offers the existing manual wa.me link.

## 7. Message router, fallback, logging

One server-side router: resolve customer → capabilities → consent → chosen primary channel → send → record result. Fallback is opt-in per message/campaign (e.g. push then SMS after N minutes with no delivery), never automatic multi-channel. Duplicate prevention by idempotency key (customer + template + reference + window). Retries and scheduling reuse `notification_jobs`. Rate limits per customer per channel per day, plus a global daily SMS cap so a mistake cannot drain credit.

Communication log per message: channel, type, body/template + variables, direction, sender (staff user), recipient identity used, status (queued/sent/delivered/failed/skipped), failure reason, campaign id, order id, timestamps. This is the profile timeline.

## 8. Campaigns & segments

Existing segments (New / Returning / Frequent / Inactive) are computed live and stay. Add: high-value, birthday, guests only, registered only, area-based, frequency bands, never-ordered-again. Campaign = segment + channel + template + schedule + consent filter; expands into individual queued messages so each one is logged and capped.

## 9. Composer & templates

Templates with variables `{customer_name} {order_number} {order_total} {restaurant_name} {offer_code}`. Rendering is server-side from whitelisted variables only (no free interpolation of arbitrary data). Composer shows recipient, channel with capability state, live preview with real values, SMS character/segment count, send now or schedule.

## 10. Privacy, permissions, security

New permission keys (each No access / View only / Full access): Customer profiles, Customer messaging (transactional), Customer marketing/campaigns, Customer identity merge (owner only), Communication logs. Staff get none implicitly. Phone numbers stay masked unless the person has full customer-profile access; every unmask and every send is audited. All new tables: RLS on, nothing to anon, customers may read only their own consent/preferences, writes only through owner/staff server functions after a permission check. Unsubscribe link/keyword sets the marketing consent flag off and never blocks transactional messages.

## 11. External services

- Web Push: already complete (VAPID keys, service worker, delivery audit). No cost.
- SMS: provider already integrated (sms.net.bd / Alpha SMS) with `ALPHA_SMS_API_KEY`; needs the key present in this environment plus a sender ID and credit for customer messaging. Pricing requires provider verification.
- WhatsApp: requires a Business API provider (Meta Cloud API or a BSP), a verified business, a registered number, approved message templates for anything outside a 24-hour window, and an API token secret. Pricing and approval requirements require provider verification. Addable later with no CRM redesign — it is one more channel in the router.
- Email: requires a transactional provider (e.g. Resend/Postmark/SES) with a verified sending domain and API key secret. Pricing requires provider verification.

## 12. Proposed new tables (not created)

`crm_customers`, `crm_customer_identities`, `crm_customer_merges` (audit + pending confirmations), `crm_customer_notes`, `crm_customer_tags` (+ join), `customer_communication_preferences` (consent per channel, marketing flag, preferred channel, unsubscribed_at), `message_templates`, `customer_messages` (the log/outbox with idempotency key), `campaigns` + `campaign_recipients`. Plus one nullable `crm_customer_id` column on orders. Required immediately: crm_customers, identities, preferences, customer_messages. Later: templates, campaigns, tags, merges UI.

## 13. Architecture

```text
Customer (account / guest)
  -> Customer Identity (auth_user | verified phone | email)
  -> CRM Profile (orders, spend, reviews, rewards, notes, tags)
  -> Communication Preferences (consent, marketing opt-out, preferred channel)
  -> Channel Capability (in-app / push / sms / whatsapp / email)
  -> Message Router (type, consent, idempotency, rate limit, schedule)
  -> Delivery: in-app row | Web Push | SMS | WhatsApp | chat thread
  -> Delivery Tracking (status, failure reason, retry, fallback)
  -> Communication History (profile timeline + campaign reporting)
```

## 14. Roadmap

- Phase 1 (no external service, low risk): customer profile page, search/sort, notes, tags, CRM record + identities built from existing orders, phone masking + audit, new permission keys. Nothing existing changes behaviour. Rollback: hide the route.
- Phase 2: communication preferences + consent, capability traffic light, communication log, owner-initiated chat on top of existing conversations. Test: existing customer-initiated chat still works both ways.
- Phase 3: message router + composer + templates; customer SMS via the already-integrated provider (transactional first), rate limits and caps. Risk: SMS credit — mitigated by caps and a dry-run mode.
- Phase 4: guest→account linking with owner confirmation and merge audit. Highest data risk, so it comes after the log exists; reversible by design.
- Phase 5: campaigns, segments, scheduling, marketing consent enforcement, unsubscribe.
- Phase 6 (optional): WhatsApp Business API, then transactional email.

## 15. Direct answers

- Guest with only a phone: reachable solely by SMS through the existing provider once it is configured, or manually via the existing WhatsApp link; no in-app or push is possible without an account.
- Registered customer: in-app notification + Web Push today (both already working), plus chat; SMS once a verified phone exists.
- Guest orders join a future account when that account verifies the same phone by OTP and exactly one unlinked guest record matches — otherwise owner confirmation, always audited and reversible.
- Owner-initiated chat is added by letting a server function create the conversation row that today only customers can create; the customer side needs no change.
- Cleanest architecture is one router in front of the existing delivery layers, driven by capability + consent, with every send logged.
- Already built and reused: push stack, notifications, job scheduler, SMS sender, conversations, orders, permissions, reviews, rewards.
- Completely missing: identity/CRM records, consent, router, logs, composer, campaigns, customer SMS/WhatsApp/email paths, profile page.
- Consent to collect: marketing opt-in per channel, phone verification, WhatsApp opt-in, and a visible unsubscribe.
- End state: a searchable customer list, a full profile with history and timeline, a channel-aware message button, campaigns by segment, and complete delivery logging — with today's features intact.
