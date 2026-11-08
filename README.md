# Dungeons & Daiquiris — local D20 drinks

Open `index.html` directly in a modern browser. Offline mode has no runtime dependencies or external requests. Optional session sharing uses the public Supabase configuration in `config.js`. Keep the accompanying scripts and stylesheet with it. It works offline as local files. Browser storage belongs to the browser/profile and origin; clearing browser data also clears local records.

## GitHub Pages and home-screen installation

The controller is `index.html`; the independent TV/iPad waiting screen is
`presentation.html`. The presentation connects through the optional Supabase session link.
Both use relative asset paths for deployment beneath `/Dungeons-and-Daiquiris/`.

In repository Settings > Pages, select **GitHub Actions** as the source.
Pushing to `main` runs `.github/workflows/pages.yml`: Node 22 runs the existing
tests, `node scripts/build.cjs` copies an explicit app-only allowlist into `_site`,
and the Pages actions publish that artifact. No packages or secrets are required.
The workflow can also be run manually from Actions.

Expected production URLs after a successful deployment:

- Controller: https://solodevfailure.github.io/Dungeons-and-Daiquiris/index.html
- Presentation: https://solodevfailure.github.io/Dungeons-and-Daiquiris/presentation.html

On iPhone/iPad, open the required URL in Safari, choose Share > Add to Home
Screen, leave Open as Web App enabled if offered, then tap Add. Separate manifests
and app IDs preserve the correct launch page for each shortcut. Visit once online
to install the offline cache. HTTPS is required for service workers.

The service worker caches only app assets, never changes localStorage, and
deletes only obsolete caches bearing this app's prefix. New versions wait for
existing app windows to close. Bump `CACHE_NAME` in `sw.js` whenever assets change;
close all app windows and reopen after loading a new release to activate it.

Existing settings, active drinks and history keep their original storage keys.
Local-file URLs and the hosted HTTPS site have different browser storage, as do
different devices/profiles; the hosted app cannot automatically read those earlier
records. Home-screen web apps may also have separate storage from Safari. Do not
clear the original browser data. Cross-origin transfer/sync is not implemented.

## Local flow

Select exactly three numbers, toggling any selection before confirmation. Confirm generates and saves the drink atomically before presenting it. Back preserves the sealed roll; View Your Drink reopens it. Pour Next Drink requires confirmation and saves the snapshot before resetting. An active drink also survives reloads.

Options edits names, requested amounts and ABV. Save returns to the main screen. Both the in-app Back and browser Back protect unsaved edits. History is newest first; entries reopen read-only snapshots. Clear History requires confirmation, retains any active drink, and that active drink is archived again when Pour Next Drink completes.

## Modules

- `services/ingredients.js`: frozen master definitions, editable configuration repository and legacy migration. Display names, requested mL and ABV are editable. Product references, classifications and generator caps remain fixed.
- `services/drink-generator.js`: pure recipe rules. `D20.drinkGenerator.generateDrink(ingredients, { id, createdAt })` creates a serialisable result; passing identity/time makes the entire output reproducible. Without them it supplies a UUID and current timestamp. No network, DOM or persistence dependencies.
- `services/storage.js`: JSON storage adapter, injectable for tests or a future backend repository.
- `services/drink-history.js`: versioned snapshot repository. History and the active drink share one storage transaction. Failed writes leave the prior state intact; unreadable history is never silently replaced.
- `services/ai-service.js`: `buildAIPayload(result)` creates an independent copy with exact ingredients, quantities, ABVs, product references and preparation constraints. `promptAPI(result)` is an asynchronous offline placeholder returning null. Results have `apiStatus: "not_configured"`. A future backend may add presentation data, never alter engine quantities.
- `app.js`: navigation, accessible controls, editor and result rendering. Result rendering consumes snapshots, not the current ingredient database. A future TV renderer can consume the same object without accessing the phone UI.

The browser uses ordered classic scripts rather than ES module imports so direct `file://` use remains functional. The modules are grouped under `D20`; they can also be loaded in Node for testing.

## Deterministic recipe policy

The liquid ceiling is 150 mL, including added chilled water and excluding unmodelled ice melt. Recipes are never padded to that ceiling. Amounts are calculated in integer hundredths of a mL and only rounded down. Zero requested amounts remain visible as zero-volume rolls.

Each ingredient is first limited to its requested amount and its internal cap. Caps are 15 mL for 151 Rum; 5 mL hot sauce; 10 mL Worcestershire; 20 mL lime; 15 mL tomato sauce; 60 mL for ordinary spirits, Fireball and Baileys; 150 mL for other individual slots. These are fixed game rules, independent of editor values.

If compression is necessary, reduce mixers, then beer/cider/stout, then wine, then other low-ABV components, then remaining ingredients. Equal-priority components share reductions; a positive roll retains at least 0.01 mL. Example: Jack Daniel's 30 + Coke 80 + Guinness 80 becomes 30 + 40 + 80, reflecting the explicit mixer-first rule.

A spirit-heavy drink gets up to 15–30 mL chilled water; overproof alongside another spirit requests 45 mL. Available space limits the addition. Water changes concentration, not pure alcohol. Three spirits remain three spirits. Ingredients are never increased to fill unused capacity.

Preparation rules detect carbonation from metadata or tags, prohibit shaking carbonated mixtures, identify dairy/acid conflicts, avoid shaking wine, pour carbonation near the end, and add hot sauce last. Only chilled water and ice may be introduced by the generator.

ABVs are the approximate Australian/reference values supplied in the brief, not live product lookups. Renaming a slot does not identify a new product or infer its ABV; edit ABV explicitly. Stored brands/products remain reference metadata. A later advanced ingredient-management feature can explicitly handle changes to those classifications.

## Existing settings

The v1 ingredient list migrates to v2 without deleting the original. Each field matching its old default adopts the new default; differently named or quantified fields are preserved. Matching old defaults cannot be distinguished from a user intentionally saving the same value. New settings store names, requested mL and optional ABV. Existing v2 records without ABV use reference values without rewriting those records. Fixed generator metadata remains protected.

## Verification

Run the dependency-free engine/repository suite:

    node --test tests/generator.test.cjs tests/session.test.cjs tests/presentation.test.cjs

It covers all 1,140 three-slot combinations at default amounts and again with extreme amounts, plus alcohol maths, preparation constraints, migration, snapshot isolation, storage errors and the inactive API hook.

The optional browser check uses Playwright and installed Chrome:

    node tests/browser-check.cjs

Install Playwright separately or set `D20_PLAYWRIGHT_PATH` to its module path. `D20_SCREENSHOTS` optionally selects an output folder. It runs offline and checks common phone/desktop viewports, the complete game loop, read-only history, reloads, dirty browser navigation, confirmations and failed storage writes.

Supabase sessions, anonymous host authentication, players and read-only display pairing are implemented but require project configuration. See [Phase 1 setup](supabase/README.md). OpenAI, auctions and scoring remain unimplemented.
