# Burger Stack Challenge — how it can be added

## What already exists (inspection result)

The challenge system is configuration-driven, not game-by-game code:

- **One shared engine.** A challenge row carries a game "type" plus two JSON setting blocks (game settings and winning condition). The player screen picks the matching mini-game by that type. Registered types today: reaction tap, timing stop, memory flash, avoid-the-bomb, number rush, **stacking**, dice, coin toss, and bottle flip (marked not playable, camera-based).
- **A stacking game is already built and playable.** Its on-screen title is literally "Burger Stack": a burger layer slides left/right, the customer taps DROP, and mis-aligned drops end the run. Its settings are `target_layers`, `tolerance`, `speed`. Score = layers stacked.
- **Plays, attempts, cooldowns, refills, order/referral unlocks** are all handled centrally per challenge (free plays every X hours, extra play for an order over an amount, extra play for verified referrals, max stored plays, cooldown).
- **Rewards and winner limits** are also per-challenge: reward type (free item, voucher, points, custom), reward name/quantity, daily winner limit, total winner limit, max wins per customer. Wins are recorded server-side and claimable from the customer's Challenges page; the winner ticker and "Your wins" list update automatically.
- **Owner Dashboard → Challenges** already has a full create/edit form: name, slug, icon, game type, difficulty, status, schedule (dates + daily hours), attempts, required score, time limit, game settings JSON, winning condition JSON, reward block, play-unlock block, winner-limit block, sort order.
- **Winning is judged on the server** from the reported score against the required score — the browser cannot declare itself a winner.

## Conclusion

Burger Stack Challenge needs **no new game code, no new database table, and no schema change**. It is a new challenge entry using the existing stacking game type, created through the existing Owner Challenges form.

## Implementation plan

1. **Create the challenge from the Owner Dashboard** (no code, no migration):
   - Name: Burger Stack Challenge · icon 🍔 · slug `burger-stack-challenge`
   - Game type: stacking mini-game
   - Required score: 6 (layers) · attempts per session: 1 · time limit: none
   - Game settings: `{ "target_layers": 6, "tolerance": 16, "speed": 2.2 }`
   - Winning condition: `{ "min_score": 6 }`
   - Reward: free item — e.g. "Free Flamio Classic Burger", quantity 1
   - Plays: 1 free play, refill every 24h, plus the existing order/referral unlocks if wanted
   - Winner limits: daily 5, max 1 win per customer
   - Status: draft first, then active after a test play.
2. **Optional polish, only if you want it** (small, additive, does not touch other games):
   - Show the burger layer count as a nicer visual (stacked layers with a bun top) inside the stacking game screen only.
   - Add a "near miss" message when the customer stacks one layer short.
3. **Verify** after creation: challenge appears on the customer Challenges page, play consumes one play, a winning run records a claimable reward, the daily winner limit blocks further wins, and every other challenge is untouched.

## Guarantees

- No existing game, challenge row, reward, or owner control is modified.
- No database change is required for step 1.
- Nothing is rebuilt or duplicated — the new challenge reuses the existing engine end to end.
