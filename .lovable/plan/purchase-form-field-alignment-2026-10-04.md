# Purchase form field alignment

## Scope
- Restructure only the **Others** purchase form to show, in order: Date, Supplier (Optional), Name, Quantity, Unit Price, Note, Payment Method (Optional), and a read-only Subtotal calculated as Quantity × Unit Price.
- Add the same optional Payment Method selector to the existing **Inventory / Stock** purchase form, with Cash, bKash, Nagad, Bank, and Card options.
- Keep the Inventory / Stock form’s current fields, calculations, stock increase, and save behavior otherwise unchanged.
- Reuse the existing `purchases.payment_method`, quantity, unit-price, and total fields; no schema or data migration.

## Save behavior
- Save an Others purchase through the existing expense function, with its subtotal calculated server-side from quantity × unit price. It remains an expense and never changes inventory stock.
- Save the optional payment method for both purchase types without affecting calculations.
- Keep Purchase History, existing records, and Owner edit/delete behavior unchanged.

## Files
- Update `src/routes/_authenticated/owner.purchases.tsx` for the two forms and displayed subtotal.
- Update `src/lib/purchases.functions.ts` only to validate/store Inventory payment method and calculate the Others subtotal from quantity and unit price.
- Add or update one focused calculation test alongside existing tests if a suitable test location exists.

## Verification
- Run the focused test, TypeScript check, and confirm the preview build succeeds.
- Confirm no sales, checkout, inventory stock calculation, or unrelated files changed.
