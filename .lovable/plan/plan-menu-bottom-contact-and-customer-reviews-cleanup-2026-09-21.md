# Plan: Menu-bottom contact and customer reviews cleanup

## What I found
- The Home page currently owns the bottom “Find Flamio” section through the existing `LocationSection`.
- The Contact page already has a reusable `ContactRow`, restaurant settings, Facebook page name/link, Instagram link, owner phone, WhatsApp number, and customer inbox toggle.
- The Contact page currently still includes Location and Opening Hours rows; this request removes Location from the requested Contact area and reorganizes only existing contact actions.
- Reviews already use the `order_reviews` table, `review-photos` private storage bucket, customer profile names, owner moderation, and order-linked review flow.
- Current review support is order-only and photo-only; there is no video review field/bucket in the existing schema.

## Changes to make
1. **Find Flamio section**
   - Keep the existing section at the bottom of the Home/menu flow.
   - Remove the Location row.
   - Show only:
     - Contact icon row linking to the existing Contact page.
     - Facebook row using the existing configured Facebook page name/link.
     - Instagram row only when an Instagram link exists.
   - Do not add duplicate Location, Opening Hours, or Contact content.

2. **Contact page organization**
   - Reuse the existing Contact page and `ContactRow` visual pattern.
   - Remove Location from this Contact page area.
   - Order actions as: Call Restaurant, WhatsApp, Call Owner, Customer Message / Inbox, Facebook Page, Instagram, Messenger if enabled.
   - Hide missing phone/WhatsApp/Instagram actions rather than rendering broken buttons.
   - Keep enabled-but-missing configurable actions as “Not configured yet” only where that existing settings behavior is already used.

3. **Reviews at the bottom**
   - Add a customer review section below Find Flamio, before the footer.
   - Reuse `order_reviews`, owner moderation, and approved-only public display.
   - Extend the existing review model minimally to allow general reviews without an order by making `order_id` nullable.
   - Add `video_path` to the same review table and use a private `review-videos` bucket with the same user-folder storage pattern.
   - Keep the existing order-linked review page working, including completed-order checks.
   - Add a public/general review form that uses profile data when signed in; if signed out, collect a display name and store it safely without exposing private data.

4. **Owner moderation**
   - Keep the existing owner review screen and actions.
   - Show video previews there when available.
   - Do not add a second moderation system.

## Technical details
- Add a migration for nullable `order_id`, `guest_name`, `video_path`, indexes, policy updates, and a private `review-videos` storage bucket/policies.
- Update review server functions to list approved general reviews, submit signed-in or guest reviews, and include photo/video signed URLs.
- Keep uploaded photo/video validation client-side and server-side path validation.
- No unrelated routes, cart, orders, POS, kitchen, inventory, payments, or owner dashboard features will be changed.

## Verification
- Check phone and desktop layouts for no horizontal overflow.
- Confirm Find Flamio has exactly Contact, Facebook, and conditional Instagram.
- Confirm Contact page has no Location row and uses existing configured actions.
- Confirm Facebook and Instagram visibility/link behavior.
- Confirm general review submission works without an order.
- Confirm existing order-linked review still works.
- Confirm approved reviews display publicly, pending reviews stay hidden, and owner moderation remains available.
- Run typecheck/build and fix only issues caused by this change.
