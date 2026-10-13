# Preserve the latest Counter Sale receipt during navigation

## Change
- Keep the latest completed Counter Sale receipt in shared in-memory state within the existing Counter Sale module.
- Restore that receipt when the Counter Sale page remounts.
- Replace it whenever a newer Counter Sale succeeds.

## Scope
- Change only `src/routes/_authenticated/owner.pos.tsx`.
- Do not alter receipt printing, order creation, pricing, inventory, permissions, or other interface elements.
- Do not use browser storage or database persistence.

## Verification
- Confirm the automatic type-check and build pass.
- Confirm the exact changed files.
