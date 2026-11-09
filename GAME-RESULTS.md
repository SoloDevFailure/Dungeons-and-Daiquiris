# Awards, final analytics and archived restarts — release 10

## Deployment

Run **only** `supabase/migrations/202611090002_game_results.sql` in the Supabase project's SQL Editor, as a complete query. The previous `202611090001_phone_gameplay.sql` must already have been applied (points currently working confirms that). Do not rerun earlier migrations.

This is additive: it adds internal validation/projection functions and replaces the existing RPC implementations while preserving their signatures, owner checks, read-only capability checks and grants. It does not delete data, change credentials or create another session/game row. Local/browser tests do not execute this migration against PostgreSQL; applying it and checking real-device synchronization are still required.

Then commit/push through GitHub Desktop and wait for GitHub Pages deployment. Reopen the phone and iPad app windows to activate release **v10**. Existing pairing links remain valid; new QR links request release 10. Never clear site storage to update.

## Phone flow

- Complete Round saves the immutable award, releases the phone's roll, and leaves the shared recipe selected. The display detects that the selected encounter has been awarded and shows recipients, actual awarded points and individual 50% penalties.
- The award remains until a different recipe is published. A newly rolled recipe takes priority. Skipping a subsequent roll returns to welcome rather than resurrecting an earlier award (using the server's latest-encounter projection).
- Finish Game is on the roll-selection screen. An active drink must first be awarded or skipped. Confirmation writes `finishedAt`; the iPad displays final results regardless of the last selected recipe.
- The finished report stays until New Game or a connection failure. On reconnect it restores automatically. Refresh restores a finished game; no additional host action is needed.
- New Game is offered after finishing. Confirmation archives the previous game number, award-index range and finish time, then starts a fresh scoreboard. The same permanent Supabase record and pairing capability are reused. All historical awards/recipes and ingredient settings are retained. There is no destructive reset.

Gameplay continues using its existing storage key, schema and durable outbox. New optional lifecycle fields are `finishedAt`, `roundStart`, `gameNumber` and `archives`. Rankings/statistics use the current award range; the full append-only award ledger remains intact. The server checks finish/restart transitions and prevents older clients from removing an existing finish state or silently resetting scores.

## Presentation and report

Award, drink, welcome and analytics scenes use keyed fades. Repeated one-second polls do not replay the animations or reset report pages. The fixed 16:9 safe area remains free of scrolling. Long content is fitted; rankings page in groups of eight and the complete drink ledger in groups of five. Report pages rotate every 12 seconds. Visibility/page suspension pauses page timers, animations and polling.

The report includes current-game rankings (including ties), total points, award counts, participating rounds per player, estimated allocated alcohol, hot-sauce volume and recorded drops, half-point penalties, highest/lowest agreed-to-starting bid ratios, highest recipe ABV, and every completed drink with recipients and actual awards.

Only recorded facts are reported: highest/lowest bid ratios are comparisons, not a count of verbal bids or a claim about which drink was most feared. Skipped/unawarded rolls are retained in recipe history but excluded from awarded-round statistics. Unavailable recipe snapshots are explicitly disclosed and excluded from volume estimates.

Alcohol/hot-sauce estimates are allocated from immutable recipe snapshots, not measured consumption. For one recipient, one recipe serving is counted; for two, two servings; for three, the original two-serving batch is divided three ways. A 50% points penalty changes points only: no consumed-volume amount was recorded, so volume estimates are not halved. Legacy recipes whose flat quantities represented a two-serving batch are interpreted on that original basis. No ABV or recipe is recalculated from today's ingredient settings.

Recipe snapshots for report calculations are projected only while finished, avoiding transferring the entire recipe history during ordinary one-second polling. Helper functions have no anonymous/authenticated execute grant. The existing capability-protected presentation RPC exposes the report data after checking the read token; the owner-protected host RPC exposes it only to the original host.

## Recipe correction

Engine 1.2.0 caps each hard spirit at **15 mL** and all hard spirits together at **30 mL per serving**. Beer/cider/stout/wine and low-alcohol liqueurs such as 17% Baileys are excluded from that combined cap. Their alcohol still contributes to final ABV. A three-spirit recipe can contain 10 mL of each (30 mL total); one spirit plus mixers can reach 90 mL with at most 15 mL of that spirit. Optional balancing additions count toward the total as before.

High ABV alone no longer forces the entire drink into a 15 mL shot. Difficult blends retain smaller-serving rules (normally 30 mL); multiple-condiment and overproof rolls retain their dedicated shot ceiling. Warnings, blocked-roll rules, no-padding rules, inventory restrictions and two-serving batch calculations remain. Saved lower serving caps still apply. Existing ingredient names, ABVs, requested amounts, policy preferences and old recipe snapshots are not overwritten. Earlier 1.1.0 snapshots retain their original spirit/liqueur calculation semantics.

## Verification

The dependency-free suite covers limits/ABV/batches across all 1,140 three-slot combinations, old snapshot preservation, award persistence/next-drink priority, full/half awards, finish/restart/archive restoration, report allocation for 1–3 recipients, legacy batches, missing snapshots and pagination/animation identity.

Browser QA used an isolated local mock server and the real phone/presentation code. It verified two rounds, automatic recipient updates, a subsequent recipe replacing awards, finish-to-report, refresh recovery, New Game zero totals with earlier history retained, and disconnect leaving the final report. The report fit 1600 × 900 with no page overflow. No live Supabase rows or real host/browser data were changed.
