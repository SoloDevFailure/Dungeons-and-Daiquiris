# Phase 1: connect Supabase

## What is implemented

The phone remains a local, dependency-free app. A session is optional. When configured,
Game Session creates an anonymous host identity and a persistent session from the
phone's existing ingredient settings. Players can be registered before or during play.
Recipe generation still commits locally first. Full unmodified result objects are then
queued as immutable encounters; current-encounter selection and upload happen in one
database transaction. Each encounter records two servings. Quantities and alcohol
figures remain for the entire existing recipe (maximum 150 mL), split into two servings;
this phase does not double the recipe. No points, auction rules or OpenAI calls are added.

The iPad link uses a random 256-bit read capability in the URL fragment. The viewer
polls once per second while visible, never overlaps requests, and retains its last
successful display during outages and across refreshes. Failed requests retry. Host
uploads retry every five seconds while visible and when connectivity returns.

## Manual project setup

1. In Supabase SQL Editor run `supabase/migrations/202611080001_phase1.sql` once.
   Alternatively use the Supabase CLI migration workflow on the linked project.
   Do not paste database passwords or privileged keys into the application.
2. Enable **Allow anonymous sign-ins** in Authentication settings. This application
   uses Supabase Auth's anonymous users, not unauthenticated write policies.
3. From the project's Connect/API settings obtain the project URL
   (`https://PROJECT_REF.supabase.co`) and **publishable** key (`sb_publishable_...`).
   Populate `config.js`. These two values are intended to be public browser config.
   Secret/service_role keys are rejected by the client and must never be committed.
4. Keep the Data API enabled with `public` exposed (the Supabase default). No Realtime,
   Storage bucket, Edge Function, OpenAI secret or CORS proxy is required for this phase.
5. Run `node --test tests/generator.test.cjs tests/session.test.cjs tests/presentation.test.cjs`, then
   `node scripts/build.cjs`. Commit/push and let GitHub Pages deploy. Close all app
   windows after loading the new release so the waiting service worker activates.

Auth's default anonymous-signup rate limits apply. If CAPTCHA is enabled in Auth,
a CAPTCHA UI/token integration is required before session creation will work.

## Phone-to-iPad acceptance check

1. Open the HTTPS controller on the phone. Existing settings/history should still be
   visible. Choose Game Session, name the game and create it. No local history is bulk
   uploaded. An existing active drink is included if one was present at creation.
2. Register players. Reload the phone; session and players should restore.
3. Copy the read-only iPad link to Safari on the iPad. Keep the entire fragment. Use
   this same link for home-screen installation; the viewer also remembers its last link.
4. Generate a new drink. Within roughly a second of a successful upload the iPad
   should show its name, ingredients, additions, method, warnings and alcohol figures.
5. Disable the phone's network, finish/generate another drink and reload the phone.
   Re-enable connectivity: queued operations should arrive once, in order. A retry
   after an ambiguous response must not duplicate encounters or players.
6. Disconnect the iPad, refresh it, and reconnect. The last display should remain and
   update automatically. Finishing the current drink returns the live display to waiting.
7. Edit name, ABV and quantity; save/reload. Historical encounters must retain the
   original values. Existing v1/v2 ingredient records lacking ABV use the master ABV
   without rewriting saved records just by opening the page.

## Restoration and conflicts

The host identity and refresh token live only in localStorage on the host browser.
Session metadata, player registrations, ingredient configuration and encounters live
in Supabase. Refresh automatically restores the saved session and drains its outbox.
A network error or expired/revoked identity never creates a replacement identity.
Anonymous host access cannot be recovered on another device/profile or after clearing
browser data. Account sign-in/host recovery is a future extension, not implemented here.

Use one controller tab. Web Locks serialize token refresh and sync where supported;
server revision checks reject stale writes across tabs/devices. If a revision conflict
occurs, Restore / Review Session fetches the latest state without replacing local
settings or clearing pending changes. Review it before Retry Sync applies pending edits.

Use Session Ingredients explicitly imports shared settings, with a local recovery copy
at `dungeons-daiquiris.ingredients.before-session-import`. It refuses while ingredient
edits are unsaved or queued. Publish Device Ingredients explicitly uploads local values.
Restore Current Drink imports the shared snapshot only if no different local drink is
active, preserving the local ledger. Local history is never replaced by cloud history.
Publish Current Drink / Waiting Screen can reconcile the display manually after a
local outbox write fails (for example storage quota). Sync errors remain visible inside
Game Session; the local generator remains usable. Cloud mode is optional and disabled
until `config.js` has a URL and publishable key.

Renaming a slot or editing ABV does not update its fixed compatibility metadata, tags,
or generator caps. Changing a slot to an entirely different ingredient needs a future
metadata editor; ABV edits do change subsequent recipe alcohol calculations.

## Access model and checks

All four tables have RLS enabled and no browser table grants/policies. Only scoped
RPCs are callable: authenticated hosts create/read/mutate sessions they own, while
unauthenticated displays can call only `d20_presentation` with the correct session ID
and token. Functions use an empty search_path and schema-qualified objects. Display
responses exclude host identity, other players, settings, history and token hashes.
The display token is stored hashed in the database and never grants writes. Anyone
with the link can view the current recipe. Keep host localStorage private. Delete the
session through trusted database administration to invalidate its display link; a
rotation UI is not part of this milestone.

Run `supabase/tests/phase1_access.sql` against a disposable/local Supabase database
after the migration. It checks owner isolation, anonymous denial, read-link scope,
raw-table denial, invalid settings/recipes, immutable snapshots, idempotency and stale
revisions. It rolls fixtures back. Node tests cover offline/reload/retry and local-data
preservation independently of a project. `tests/browser-check.cjs` remains the offline
regression check; `tests/cloud-browser-check.cjs` uses a mocked RPC backend for the
phone/display flow and reconnect behavior. Neither replaces running access tests and
the acceptance check against the actual Supabase project.

## Current connection and final verification

`config.js` now targets `https://ilsgfyghlnwgjvvbikxa.supabase.co` with the supplied
publishable key. The service-worker version was advanced to v3 for this release.
The previous deployed controller lacked Game Session and `config.js` returned 404;
a new GitHub Pages deployment is required before testing live sharing.

If the schema has not yet been installed, open the Dungeons and Daiquiris project,
SQL Editor → New query, paste the entire contents of
`supabase/migrations/202611080001_phase1.sql`, then click Run. This migration creates
only the four d20 tables and scoped functions; it does not reset ingredients or
history. Run it once. If Supabase reports a d20 table already exists, do not delete
anything or rerun piecemeal: run `supabase/verify-deployment.sql` and inspect the
results instead. This verification file is read-only; all boolean columns should
be true once the schema is complete. Save/copy any SQL errors exactly as shown.

After the schema exists, `node scripts/verify-supabase.cjs` exercises the configured
real API: anonymous signup, session creation/restoration, players/config, immutable
encounter retries, current encounter/clear, read-only display scope, owner isolation
and raw-table denial. It creates two anonymous test identities and one clearly named
verification session, leaves that test session for inspection, and never touches
existing user sessions or local browser data. It requires network access. Do not
confuse successful unit/mocked tests with successful real-project verification.

Idle host sync now refreshes metadata from Supabase instead of reporting cached
state as live. It preserves local ingredient edits and history. The viewer can
also display a valid session URL when iPad storage is unavailable (offline refresh
still needs working storage and a previously installed service-worker shell).
