# Serving rules — generator 1.2.0 / snapshot schema 2

The existing generator pipeline remains: validate inputs, cap ingredient pours,
compress to a portion, calculate additions/alcohol, generate preparation, then
save an immutable result. New results use integer hundredths of a mL throughout
liquid allocation. No existing ingredient-setting or recipe record is rewritten.

## Default portion rules

| Rule | Per serving |
| --- | --- |
| Ordinary / beer / cider mixture | At most 90 mL |
| Multiple condiments or overproof mixture | At most the configured 15 mL condiment/overproof shot ceiling |
| Hot sauce, alcohol-heavy, other savoury, dairy/acid or citrus-heavy mixture | At most 30 mL by default; configurable up to 45 mL |
| Each hard spirit | At most 15 mL |
| Combined hard spirits | At most 30 mL, or the lower configured cap; beer, cider, stout, wine and low-alcohol liqueurs are excluded |
| Overproof ingredient | At most 5 mL before further portion scaling |
| Worcestershire | At most 1 mL |
| Tomato sauce | At most 3 mL |
| Selected citrus juice | At most 5 mL |
| Dairy-based ingredient | At most 15 mL before combined spirit/portion limits |
| Hot sauce | Normally 2 drops; 1 when another condiment is selected |

These are ceilings. The engine never pads a small recipe to a target. Positive
selected pours are retained where the configured limit permits; zero requested
pours stay zero. Tiny/fractional limits may leave a selected ingredient at zero,
which is recorded explicitly. Mixer-first compression remains, with proportional
allocation within each priority group. The compressed blend is reassessed for
strength: a mixture at 30% or more before optional additions uses the small-serving
ceiling (30 mL by default), not a mandatory 15 mL whole-drink ceiling. No combination can bypass the spirit cap by editing names or requested
quantities. Hard spirits are fixed spirit-category slots, overproof ingredients and other non-beer/cider/stout/wine ingredients at 25% ABV or more. A cream liqueur such as Baileys at 17% is excluded from the hard-spirit cap, while its dairy-specific pour cap still applies.

## Optional additions and availability

The controller passes its actual ingredient repository to the generator. Automatic
lime requires slot 18 to retain its citrus metadata, have a positive requested
amount, be enabled, and have zero ABV. Zero quantity disables automatic use. Lime
is considered for sweet/spirit or savoury blends, not every roll. It is skipped
for dairy, existing acidity, an already-selected lime slot, or unavailable stock.
A balancing addition is at most 2 mL (1 mL for shots), further limited by the
available requested amount and the size of the original pour. It counts toward
the serving ceiling and is listed in preparation, results, snapshots and batches.

Water and ice default to unavailable. Enable them under **Options → Serving Sizes**
only when they are actually in the pantry. Water is a small optional dilution for
strong blends, never a fill ingredient; all its liquid counts. Ice is preparation
material, not measured liquid; later ice melt is excluded from the estimate.
Hot sauce uses a configurable nominal mL/drop calibration (default 0.05 mL/drop,
0.01 mL increments). Both drops and the approximate liquid volume are displayed.
Batch drop counts double exactly. The calibration is an estimate, not a claim
that all sauce droppers dispense the same volume.

## Blocking and warnings

The engine retains carbonation/no-shaking, dairy/acid, hot-sauce and strong-drink
warnings. Concentrated condiment-only rolls, ingredients explicitly marked
`unsafeForConsumption`, `foodSafe:false` or `unsafe_for_consumption`, and a rolled
blend above the game's 40% undiluted-ABV rule are blocked. Optional lime/water
cannot clear the undiluted-strength block. A blocked result is a saved candidate,
not a recommendation: phone and iPad show **DO NOT PREPARE OR SERVE**, preparation
instructions prohibit preparing/consuming it, and the phone offers Skip This Roll.
The 40% rule and `safety.status` are game checks, not medical safety certification.
Dairy/acid curdling remains a compatibility warning rather than being called food
poisoning. Alcohol estimates use the actual final pours and configured ABVs.

## Quantities, batching and persistence

Schema-2 flat `finalIngredients`, `generatorAdditions`, `totalVolumeMl`,
`pureAlcoholMl`, `spiritVolumeMl` and `estimatedAbv` describe **one serving**.
`quantityBasis` is `per_serving`; `servingCount` is 2. The `batch` object contains
exact doubled ingredient/addition/drop/alcohol totals for two identical servings;
ABV stays the same. The host UI shows both sets separately. The iPad explicitly
labels per-serving volume and batch volume. New validators check those identities.

Earlier 1.1.0/schema-2, schema-1 and unversioned historical results keep their existing quantities,
calculations and interpretation, including original 150 mL recipes. They are not
regenerated, scaled, relabelled per serving, or migrated in storage. Names, ABVs
and requested pours in ingredient settings are unchanged; new caps affect only
new generation. Existing saved ingredient and drink storage keys are unchanged.

Serving controls are stored separately on the host controller at
`dungeons-daiquiris.serving-policy.v1`. Defaults are used in memory when no record
exists; a corrupt record is retained with a warning. Failed saves retain the
previous settings. Each new recipe snapshot embeds the exact applied policy in
Supabase. The policy control itself is local to this host browser; it is not a new
shared configuration RPC. Shared ingredient configuration continues unchanged.

The existing Supabase encounter JSON contract accepts the new nested snapshot and
its flat per-serving volume (at most 90 mL). Its legacy 150 mL bound remains for
older snapshots. The recipe correction needs no SQL change. The new lifecycle/results display separately requires the migration documented in GAME-RESULTS.md. No reset, new session or credential change is required. The existing queue retries the whole immutable
snapshot, including batch calculations and safety status.

## Verification and deployment

The automated tests cover original storage/authentication/engine behavior and the
new rules, including all 1,140 default triples, extreme requested amounts, available
extras, high-strength reassessment, drops, dairy/citrus, inventory restrictions,
correct ABV, double batches, failed settings writes, v1 preservation and unchanged
encounter queue payloads. Local browser checks exercised generation, the batch
readout, serving controls and refresh with an active saved recipe. That browser
used an isolated local origin with Supabase disabled; no real game data was changed.

Run the workflow's Node test command and `node scripts/build.cjs`. Publish both the
controller and presentation from the same build. Close/reopen all PWA windows to
activate cache **v10**; never clear browser data to update. Confirm available pantry
extras under Options → Serving Sizes. Real-device Supabase verification remains a
deployment check; the local browser and mocked queue tests do not prove live writes.
