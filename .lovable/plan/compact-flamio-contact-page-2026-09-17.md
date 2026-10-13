# Compact Flamio Contact Page

## Changes
- Add an optional Facebook Page Name field to the existing restaurant settings record.
- Add Facebook Page Name and Facebook Page URL controls to Owner Dashboard → Settings.
- Update the public restaurant settings reader to include the page name.
- Make the Contact page compact: Flamio name, Location with map link, Opening Hours, and one small linked Facebook row.
- Hide the Facebook row unless a URL exists; use a concise fallback label only when a URL exists without a page name.
- Keep the footer, header, bottom navigation, routes, and all unrelated behavior unchanged.

## Verification
- Confirm owner settings can load and save both Facebook fields.
- Confirm the Contact page renders correctly on mobile and the Facebook row links correctly.
- Confirm typecheck and build pass, then capture the final mobile screenshot.

## Technical detail
- Extend `restaurant_settings` with one nullable text column through an additive migration; no existing values or tables are changed or removed.
