# Keep the latest Counter Sale receipt visible

## Change
- Remove the **Dismiss** button from the latest-sale confirmation in the Counter Sale screen.
- Leave the existing **Print Receipt** action and latest-sale replacement behavior unchanged.

## Verification
- Confirm only `src/routes/_authenticated/owner.pos.tsx` changes.
- Check the automatic type-check and build result.

## Technical details
- Delete the button whose click handler calls `setLastSale(null)`.
- Do not change receipt printing, order creation, pricing, persistence, permissions, or other interface elements.
