# Phone controller and gameplay

## Deploy in this order

1. In Supabase open **Dungeons and Daiquiris → SQL Editor → New query**.
2. Paste and run the entire `supabase/migrations/202611090001_phone_gameplay.sql` file once if not already applied, then run `supabase/migrations/202611090002_game_results.sql` for finish/restart validation and analytics recipe projection. The two earlier migrations must already be applied; do not rerun them. The new migration is transactional and additive. It does not create another session, delete anything, or reset scores, recipes or settings.
3. Commit the changed files and push via GitHub Desktop. Wait for the Pages workflow to succeed.
4. Close all app windows and browser tabs on each phone/iPad, then reopen to activate offline cache v10. Do not clear browser/site data or reinstall: preserve the anonymous host identity and pairing.
5. Start/resume on the original host phone. Use Options → Contestants to enable/disable players or add a name. Generate a drink, Select Winners, choose 1–3, Next, enter points, optionally select individual 50% penalties, then Complete Round. Confirm totals and that the iPad returns to welcome for the next roll.

SQL has been prepared for the existing schema but requires execution in the Supabase dashboard. Local tests/mock sync do not prove the migration has been applied or validate the live database. No privileged credentials are needed in the app. If the migration is missing, recipe uploads continue first, while gameplay remains saved locally and retries; the connection panel reports the RPC error.

## Data and flow

The single permanent game is reused. Start Game starts gameplay once; Resume never resets points. Finish Game closes the current game. New Game archives its award range and starts a zero-point scoreboard in the same permanent record; all historical awards and recipes remain stored. Default enabled contestants: Dave, Tom, Dan, Damo, Nic, Jamie, Chris, Wes, Fletcher, Aaron. Existing registrations are imported using their original IDs when available. Names are checked for duplicates ignoring case and repeated whitespace. Disabling a player keeps their awards and totals.

Existing ingredient settings, serving settings, active recipes, history, anonymous authentication and display links retain their existing keys and semantics. New state uses `dungeons-daiquiris.gameplay.v1`. It contains contestants, immutable completed awards, a local award-entry draft and an outbox. New `dungeons-daiquiris.unconnected-outbox.v1` retains recipe/config actions made before the first host connection. Generated recipe snapshots are never recalculated or amended by scoring.

A batch remains two recipe servings. One to three winners may share that batch; the app does not scale it to three full drinks. The agreed points are the same for everyone, with an independent full/50% multiplier. Odd agreed values can produce half-point totals; there is no hidden rounding. The keyboard requests numeric entry. Whole agreed points must stay in the recipe's half-to-double range.

After an award is saved, it cannot be submitted for that encounter again. If advancing fails or the app closes after saving an award, reopen the active drink and press Next Drink to continue without duplicate points. Winner selection, entered points and penalties survive refresh; reopening Next → Award Points restores the popup values. Skip Without Points is available, and blocked/empty recipes cannot earn points. History can still be read; clearing local recipe history does not remove the separate award ledger.

## Starting-points rule v1

The previous app had no finalized points formula. This initial deterministic rule is implemented in JavaScript and checked independently by SQL:

- 20 base points.
- Add 4 points per mL of actual pure alcohol in one serving (from the immutable saved recipe).
- Add 20 for each positive savoury ingredient.
- Add 30 if any positive hot ingredient is present.
- Add 20 for a saved dairy/acid compatibility flag.
- Round up to the next even whole point. Minimum bid = half, maximum = double.

This is a game difficulty formula, not a consumption recommendation. Blocked or empty recipes have no bid range. The recipe engine's safety rules and serving caps are unchanged. Starting points are saved with completed awards, so later formula changes must be versioned and cannot retroactively change awards.

## Synchronisation and access

The additive migration adds `d20_sessions.gameplay`, a separate idempotency table with RLS enabled and no client table grants, and the owner-only `d20_gameplay_mutate` RPC. Existing host and read-only presentation RPCs include gameplay. Read-only pairing links still contain only the session ID and view capability. Anonymous viewers cannot call the write RPC successfully: ownership is checked against `auth.uid()` under a row lock before any write or replay response.

The server validates contestant uniqueness, append-only awards, recipient eligibility, 1–3 unique recipients, exact half/full math, and the starting/range calculation against the stored recipe. The same encounter cannot be awarded twice. Old player rows are retained. No historical award may be edited/deleted through the client. Gameplay uses its own version counter, separate from the existing recipe/config revision, so score uploads do not disrupt recipe retries. Different-host conflicts stop without rebasing or discarding local points.

Recipe/config actions upload first, so an awarded recipe exists before the server validates its award. Gameplay snapshots then upload in order with stable operation IDs; a lost acknowledgement retries the same operation. Completed awards and their outbox are committed together in one local write. The existing visibility-aware connection loop handles retries, so no extra interval runs while hidden. Presentation polling remains once per second and scoring updates do not restart drink entrance animations.

The iPad shows starting/bidding points and the current point leader (ties included) in the existing fixed footer. Award recipients now remain on screen until the next generated drink. The end-of-game report and archival New Game flow are documented in GAME-RESULTS.md. There is no AI generation.

## Validation

Run:

    node --test tests/generator.test.cjs tests/session.test.cjs tests/presentation.test.cjs tests/connection.test.cjs tests/qr.test.cjs tests/session-ui.test.cjs tests/presentation-view.test.cjs tests/servings.test.cjs tests/gameplay.test.cjs tests/pwa.test.cjs tests/results.test.cjs tests/install.test.cjs
    node scripts/build.cjs

The gameplay tests cover default/legacy players, additions, disabling, duplicate names, start/resume, points/range math, 1–3 winners, individual half points, duplicate award rejection, drafts, storage failure, remote restoration, response-loss retries and version conflicts. Browser QA used an isolated local origin with cloud configuration disabled, preserving the real game's data.
