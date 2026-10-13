<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Opening hours and scheduled-order slots live in `src/lib/opening-hours.ts` (pure, Asia/Dhaka) with the server read in `opening-hours.server.ts`; placeOrder and game play re-check them server-side — one source of truth for browser preview and server enforcement.
- Scheduled pre-orders are ordinary `orders` rows with status `scheduled`; `activate_due_scheduled_orders()` (run by the minute dispatcher) flips them to `placed`, which reuses the existing alert/Kitchen/alarm path — no parallel order system.
- Home install UI is isolated in InstallAppBanner; it consumes browser install events without registering or changing service workers, keeping notification delivery independent.
