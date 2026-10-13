# Phase 4 — Owner self-service integrations & communication control

I inspected everything relevant first. Below is what already exists, what is genuinely
missing, and the exact change set. Two new tables are required, so this needs your
approval before anything is built.

## What already exists (keep, do not rebuild)

| Capability | Status | Where |
|---|---|---|
| Payment config (Cash, bKash, Nagad, Card) | EXISTING + COMPLETE as a foundation. Owner can enable/disable, choose sandbox/live, set a merchant reference and note; keys live in the server secret store; only Cash has a live flow. | `payment_providers` table, `payments.functions.ts`, Payments section in Owner → Settings |
| SMS provider (Alpha SMS / sms.net.bd) | EXISTING + COMPLETE self-service: provider choice, sender ID, note, on/off, real "Test connection" against the provider balance endpoint, status badges, last test result. API key stays server-side. | `sms_providers` table, `sms.server.ts`, `sms.functions.ts`, SMS section in Owner → Settings |
| Login OTP over SMS | EXISTING + COMPLETE. Untouched by this phase. | `otp.ts`, auth SMS hook route, `sendSms` |
| In-app + push notifications | EXISTING + COMPLETE. | `notifications`, `notification_jobs`, `notification_push_deliveries`, `push_tokens`, `push.server.ts` |
| Customer inbox chat + per-order chat | EXISTING + COMPLETE for customer-initiated threads and owner replies. | `customer_conversations`, `customer_conversation_messages`, `order_messages` |
| CRM customers, identities, profile, notes, tags | EXISTING + COMPLETE (Phases 1–2). | `crm_*` tables, `crm.server.ts`, `crm-identity.server.ts` |
| Channel availability + history panel on a customer | EXISTING but READ-ONLY (Phase 3). | `crm-communication.functions.ts`, `CustomerCommunication.tsx` |
| Permissions & secret storage | EXISTING + COMPLETE. | `permissions.ts`, `owner.server.ts` assertions, server secret store |

## Actually missing

1. WhatsApp Business and Email provider configuration (no rows, no fields, no test).
2. Any way to actually send a customer message on a non-in-app channel.
3. Owner starting a new conversation (only replies exist today).
4. Persistent communication consent/preferences (none stored anywhere).
5. A provider-level message log with provider message ID, normalized status, and
   idempotency (`communication_logs` is only a permission name — there is no such table).

## Database changes (needs your approval)

One SQL file, `docs/sql/communication_phase4.sql`, additive only — no DROP/DELETE/UPDATE
of existing data, safe to re-run.

**Reuse, not duplicate:** WhatsApp and Email configuration goes into the **existing**
`sms_providers` table as new rows (`slug = 'whatsapp'`, `slug = 'email'`), since that table
is already exactly "one provider config per slug, secrets outside". Added columns:

- `channel text` (`sms` | `whatsapp` | `email`, default `sms` — existing row keeps working)
- `config jsonb default '{}'` for non-secret identifiers only (sender name, from-address,
  WhatsApp business/phone-number IDs)
- `secret_names text[]` so the UI can show which server secrets are still missing

**Two new tables** (nothing existing can carry these):

- `communication_messages` — customer, channel, category (transactional/service/marketing),
  provider slug, direction, provider message ID, normalized status
  (`queued|sending|sent|delivered|failed|cancelled`), timestamps, related order, actor,
  safe error text, and a **unique `dedupe_key`** for duplicate-send protection.
- `customer_communication_preferences` — per customer per channel per category opt-in,
  with source and timestamp. Marketing stays off unless explicitly opted in.

No payment, SMS OTP, notification, push, chat or CRM table is altered.

## Code changes

- **Owner → Settings → Integrations**: extend the existing Settings page, grouping the
  existing Payments and SMS sections under "Payment" and "Communication", and adding
  WhatsApp and Email cards built from the same section pattern. No second settings page.
- **Provider status**: `Not configured → Configuration required → Connected → Active →
  Disabled → Error`. "Connected" only after a real provider test call succeeds
  (WhatsApp: business phone-number read; Email: provider auth/domain check). No test
  message is sent to a customer.
- **Sending layer** (`src/lib/communication.server.ts`): one place that resolves channel
  availability (provider configured + active + valid identity + consent for the category),
  writes a `queued` row with a dedupe key, calls the provider, and records the outcome.
  Every failure is contained — nothing in ordering, checkout, POS, KDS, finance or login
  can fail because a message failed.
- **Reusable composer** (`src/components/owner/CommunicationComposer.tsx`): one component,
  channel + category + message, channels offered dynamically from the existing Phase 3
  availability read. Used from the existing customer profile panel — no new panel.
- **Owner starts a conversation**: extends the existing `customer_conversations` /
  `customer_conversation_messages` flow (creates the thread if absent), not a new chat.
- **Webhooks**: `src/routes/api/public/communication/webhook.$provider.ts` — signature
  verified, payload validated, idempotent, maps provider status onto the normalized set.
  "Delivered" only when the provider reports delivery.
- **Permissions**: new keys reusing the existing catalogue —
  `start_customer_communication`, `send_sms`, `send_whatsapp`, `send_email`,
  `manage_integrations` (owner/admin only). Staff get none by default.
- **Cost/usage**: message rows carry channel + provider + status, enough for a later usage
  report. No finance table is added or touched.

## Provider dependency (your decision needed)

I will not invent credentials. Defaults I propose unless you say otherwise:

- WhatsApp: **official Meta WhatsApp Cloud API** (business account ID, phone number ID,
  permanent access token, webhook verify token). No unofficial/QR automation.
- Email: **Resend** (API key, sender name, sender address, optional verified domain).

Both are configured by you afterwards; the code ships with the fields, the test and the
disabled state, and reports "Configuration required" until secrets exist.

## Out of scope

Marketing campaigns/segments, templates management UI, bulk sending, and any change to
payments, OTP, push, orders or finance behaviour.
