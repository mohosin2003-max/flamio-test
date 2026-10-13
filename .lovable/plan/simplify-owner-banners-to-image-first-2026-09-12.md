# Simplify Owner Banners to image-first

## Goal
Replace the current text-entry banner form with a simple image upload flow while keeping the existing banner table, owner permissions, ordering, active state, customer carousel, and empty-state fallback.

## What will change
- Add only two optional fields to the existing `promo_banners` records: desktop image URL and mobile image URL.
- Create one dedicated public `banner-images` storage bucket because no storage bucket currently exists. Limit uploads to 8 MB; the app will accept JPG, PNG, and WebP only.
- Add owner/admin-only storage rules. Uploads use the signed-in owner's session; public visitors can only view the finished banner images.
- Keep all existing text-banner columns and records intact for compatibility. Existing text-only banners continue rendering until an image is uploaded for them.
- Simplify Owner → Banners to: desktop image, optional mobile image, click destination, destination picker, display order, active state, save.
- Reuse the existing menu/category data for Category and Specific menu item choices.
- Reuse the existing click-link field instead of adding a second destination system:
  - Menu → `/menu`
  - Offers → `/offers`
  - Category → `/menu?category=...`
  - Menu item → `/menu/...`
  - Custom URL → validated HTTPS or internal path
- Show immediate local previews before saving. Replacing or deleting a banner also removes its managed banner files after the record update succeeds.

## Customer display
- Reuse the existing homepage carousel and offers banner area.
- Image banners render as the supplied image with no generated title, subtitle, button, gradient, or text overlay.
- Use the mobile image when provided; otherwise use the desktop image.
- Make the full image clickable only when a destination exists.
- Preserve the current featured-product carousel fallback when there are no active banners.

## Verification
- Run the project typecheck and production build.
- Verify Owner → Banners on a phone-sized viewport: upload preview, destination controls, active/order controls, edit and list states.
- Verify homepage rendering and Menu, Offers, Category, menu-item, and safe custom click destinations without creating orders or altering unrelated data.
- Confirm no browser console/runtime errors and confirm unrelated checkout/menu flows still load.
