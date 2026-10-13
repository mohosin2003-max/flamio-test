# Purchase label and inventory deletion safety

## Scope
- Change only the visible Inventory/Stock purchase-form label from “Ingredient” to “Name”. Keep its existing field, choices, calculations, saving, stock updates, and purchase history unchanged.
- Do not add permanent inventory deletion because the inspected schema uses `ON DELETE CASCADE` from inventory items to recipes, purchases, and stock movements. A hard delete would automatically erase those protected records, violating the requested safety rules.
- Leave the existing active/archived behavior unchanged.

## Verification
- Run the focused TypeScript check.
- Confirm the latest preview build succeeds.
- Confirm the only source change is the one visible label.

## Technical details
- Edit only `src/routes/_authenticated/owner.purchases.tsx`.
- No database, server-function, stock-calculation, permission, sales, or unrelated UI changes.
