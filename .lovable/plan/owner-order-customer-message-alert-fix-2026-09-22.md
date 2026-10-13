# Owner order customer-message alert fix

## Scope
- Keep the current Owner Order Details page and existing order messaging system.
- Change only the message-presence signal, alert styling, and the opened conversation presentation.

## Implementation
1. Extend the existing owner order-detail read to return whether any customer-authored order message exists, while keeping the current unread count and delivery note data.
2. Drive the alert from the real sources: customer-authored messages in the existing `order_messages` thread or the existing customer order note.
3. Make the existing Message Customer control unmistakably red when either source exists: red icon and label, visible top-right red badge, and restrained red pulse/glow. Keep the normal appearance when neither exists.
4. Preserve the existing click behavior, then scroll to the same message thread.
5. Restyle only the Owner Order Details conversation container with a dark background, a clear customer heading, high-contrast customer bubbles, visually distinct staff replies, and the existing bounded scroll area. Reuse the current messages and send action.

## Verification
- Run the TypeScript check and production build.
- Validate the rendered alert states with controlled component data: message/note present versus absent.
- Confirm the existing thread still opens, scrolls, identifies the customer, renders customer/staff messages differently, and keeps sending behavior unchanged.
- Confirm no database, RLS, authentication, permissions, statuses, payments, delivery, rider, kitchen, inventory, or navigation changes.
