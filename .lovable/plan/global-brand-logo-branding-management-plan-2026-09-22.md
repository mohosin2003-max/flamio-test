# Global Brand Logo & Branding Management Plan

## Inspection summary

- **Current logo system:** no reusable Flamio logo component exists. The customer header uses a hard-coded gradient `F` mark plus `Flamio` text.
- **Current logo-like locations:** customer header, auth page text, owner/staff workspace header text, staff/customer account avatar fallbacks, customer inbox title, service-worker push icon/title, root favicon link, and route metadata. Most `Flamio` text is page copy/SEO, not an image logo.
- **Current favicon/PWA:** only `public/favicon.ico` and `public/sw.js` exist. There is no web app manifest today.
- **Current storage:** existing private image buckets are `banner-images`, `product-images`, `review-photos`, and `profile-photos`, all with 5 MB image limits except the backup bucket. `banner-images` is already used for owner-managed public-facing artwork through server-created signed URLs.
- **Current settings model:** `restaurant_settings` is the existing restaurant-wide settings table and is publicly readable. It does not currently have logo fields.
- **Current security model:** owner/staff access uses `user_roles`, `staff_permissions`, `getAccessProfile`, and owner/server functions. Staff can have Settings access, so branding writes must be stricter than normal settings.
- **Current upload pattern:** banner uploads validate images in the browser, upload to private storage, then save paths through server functions. Public viewing uses signed URLs generated server-side.

## What will be added

1. **One global logo data model**
   - Prepare, but do not run, a small additive SQL file.
   - Add logo fields to `restaurant_settings`: primary logo path, icon path, version, updated by, updated at.
   - No new data table unless the current table proves unusable during implementation.

2. **Storage approach**
   - Reuse the existing private `banner-images` bucket under a `brand/` folder.
   - Do not create a new bucket.
   - Store only storage paths in the database; serve logos through short-lived signed URLs.
   - Old logo files stay in storage when replaced unless safe cleanup is handled later by the existing cleanup system.

3. **Owner-only server functions**
   - Add branding functions to read current branding, generate owner-only signed upload targets, save the active primary/icon paths, and sign active logo URLs for public display.
   - Use the real owner role only for branding changes, not staff Settings access.
   - Gracefully report “setup missing” until the SQL is manually run.

4. **Reusable Flamio logo component**
   - Create one shared component that can render the primary logo or icon.
   - It will use the latest active signed logo URL when available and fall back to the current uploaded Flamio logo / safe text mark when not configured.
   - Replace actual logo/brand mark spots only; do not touch menu/product/banner/profile/review images.

5. **Owner Settings → Branding UI**
   - Add a Branding section inside the existing Owner Settings page.
   - Include current primary/logo icon previews, upload controls, validation, preview before saving, mobile/desktop/header/icon previews, and explicit confirmation.
   - Keep it mobile-friendly and visually consistent with existing Owner Settings.

6. **App icon support**
   - Add a manifest-only PWA setup if none exists, using static generated fallback icons from the provided Flamio logo.
   - Update the favicon to a real resized file derived from the same logo.
   - Do not add offline caching or change the existing push service worker.
   - The browser/PWA icon will update in app screens via the global logo, while installed-app manifest icon changes may require reinstalling the app on some phones.

## What will not change

- No existing customer, order, checkout, payment, POS, KDS, finance, payroll, inventory, CRM, notifications, SMS OTP, or chat behavior will be rebuilt or changed.
- No existing storage bucket will be deleted, renamed, made public, or weakened.
- No existing data will be deleted or modified during testing.
- No database SQL will be executed from chat; the migration will be prepared for manual review.
- No staff/customer account will gain branding edit access.

## Verification after implementation

- Typecheck and build.
- Confirm the Owner Settings page shows Branding and current logo previews.
- Confirm staff/customer cannot access branding write functions through the UI path.
- Confirm customer header, owner/staff workspace header area, auth page, favicon link, service-worker notification icon path, and manifest configuration use the centralized branding assets where supported.
- Confirm no real data is deleted and no customer messages are sent.
