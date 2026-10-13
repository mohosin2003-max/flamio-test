# Safe inventory removal and simplified checkout location

## Scope

- Preserve the existing Inventory Active switch and all archive behavior.
- Add an Owner-only Remove action for genuinely unused, mistakenly created inventory items.
- Replace the two checkout location/address blocks with one compact delivery-location setup while keeping existing location, map, saved-address, pricing, and order flows.

## Implementation

### Inventory

- Add one authenticated server action beside the existing inventory actions.
- Re-check Owner/Admin status on the server.
- Before deletion, check the existing `purchases`, `inventory_movements`, and `product_ingredients` links for the item.
- Refuse removal when any link exists and direct the Owner to turn the item off instead.
- Also refuse if the item is missing or has non-zero stock.
- Delete only the unused item row; do not delete or alter any linked record, history, recipe, purchase, or movement.
- Add a Remove control only for Owner/Admin in the existing item editor, with a confirmation warning. Refresh the existing inventory list after success.
- Keep the Active ON/OFF switch unchanged. Disabled items remain visible in management with their Disabled badge, while existing active-only operational queries continue excluding them.

### Checkout delivery location

- Keep the existing geolocation, map picker, reverse-geocoding, coordinates, saved-address persistence, radius-zone lookup, delivery quote, and order payload.
- Present one section titled “Set Delivery Location” with the existing “Use Current Location” and “Choose on Map” actions.
- Current Location will set the pin and reverse-geocoded address automatically.
- A map pick or pin drag will set the pin and reverse-geocoded address automatically.
- Once a location is selected, show one editable “Delivery Location / Address” box containing the resolved location (or coordinates if no place name is available).
- Remove the separate location summary/save controls and separate delivery-address block.
- Keep Area immediately below and label it “Area (optional)”; remove only the existing area-required check. All delivery-charge and zone logic remains unchanged.

## Verification

- Run the existing type check and inspect the latest build result.
- Verify checkout location selection in the preview with a map click and confirm one populated address box appears.
- Verify code paths for Owner-only Remove, linked-record refusal, zero-stock requirement, and unchanged Active behavior. Authenticated deletion will not be performed against real data during verification.

## Files expected to change

- `src/lib/inventory.functions.ts`
- `src/routes/_authenticated/owner.inventory.tsx`
- `src/routes/checkout.tsx`
