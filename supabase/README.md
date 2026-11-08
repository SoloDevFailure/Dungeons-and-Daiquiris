# One permanent Dungeons & Daiquiris game

## Deploy this update

Phase 1 is already installed and working. Run **only**
`supabase/migrations/202611080002_permanent_game.sql` once in the project's SQL Editor,
then commit/push this repository and wait for GitHub Pages. Do not rerun migration 001.
The app shell cache is now v4; close all controller/presentation windows and reopen
once to activate the new release. Never clear browser storage to update the app.

Open the **original host phone browser/profile** first after deployment. It attaches
its saved game ID, anonymous identity and read token automatically. No Create or
Restore Session interface remains. The green tick opens a pairing QR code and a
Copy Link button. Existing iPad links remain valid; already-paired iPads keep their
pairing and reconnect from their home-screen launch URL without scanning again.

The migration adds one private singleton pointer to an existing session row. If
exactly one session exists, it selects that row. If multiple historical/test sessions
exist, the original phone's saved game chooses the pointer on first connection.
It never guesses oldest/latest and never creates a replacement game. Historical
sessions/encounters are retained. Ordinary clients lose permission to create extra
sessions; the old function and all existing data remain. The singleton pointer
has RLS and no browser table grants. Its recoverable read capability is returned
only by the owner-checked connection RPC. The QR contains only the display URL,
game ID and read token; no host JWT, refresh token or privileged API key.

If the phone lost its saved host identity or has a different saved game, the app
reports that condition and preserves local data. Host access is still tied to the
original browser's anonymous identity. A copied display link never grants host
access. Cross-device host recovery/account sign-in is outside this change.

## Runtime behavior

- Phone: verify the permanent game on opening, upload queued changes immediately,
  check Supabase every 30 seconds while idle, and retry failures after five seconds.
- Green means a successful server response; amber means connecting/reconnecting or
  paused; red means offline/failed. Cached metadata cannot produce a green tick.
- iPad: poll once per second while visible; remember its existing pairing and cache
  the latest successful display. Unchanged responses do not rewrite the cache.
- Both pages stop timers on visibility loss, pagehide or freeze, cancel in-flight
  data requests, and resume automatically on visibility/pageshow/resume/online.
  An already-started Auth token refresh is allowed to finish storing its rotated
  token so hiding the app cannot lose host access. No following data RPC starts.
- Local generation/history remain the first commit. The durable upload queue and
  idempotent server operation IDs are retained. An interrupted upload can retry
  without a duplicate encounter. Queued changes stay queued while suspended.
- Existing ingredient names, quantities, ABVs, compatibility rules, snapshots,
  players and storage keys are unchanged. Shared settings imports remain explicit,
  with a local recovery copy. Extra data tools are tucked under Players and Saved Data.

Use one host tab. Server revision checks reject stale writes from competing host
windows. They never silently replace a queued outbox or local ingredient settings.
If a conflict occurs, keep local storage intact and resolve the conflicting host
window before retrying. A lost network connection is retried automatically.

## Checks

Run:

    node --test tests/generator.test.cjs tests/session.test.cjs tests/presentation.test.cjs tests/connection.test.cjs tests/qr.test.cjs tests/session-ui.test.cjs
    node scripts/build.cjs

Node tests cover the original engine/data repositories, permanent-game restoration,
rejection of a different game, local-data preservation, red/amber/green state handling,
hidden/frozen/BFCache suspension and resumption, cancelled outbox uploads, rotated
Auth identity preservation, read-only QR/copy payloads, byte-mode QR decoding and
Reed-Solomon checks, plus presentation cache/recovery.

Optional installed-Playwright checks:

    node tests/browser-check.cjs
    node tests/cloud-browser-check.cjs

The second check uses a mock permanent-game backend. Neither replaces real-device
QR scanning or running the new migration against the actual project.

`supabase/verify-deployment.sql` is read-only: after both migrations, all booleans
should be true, including denial of further session creation. `node scripts/verify-supabase.cjs`
checks public configuration and unsigned/invalid-capability denial against the live
API without creating any users, games, players or drinks.

For a disposable/local Supabase database, run `supabase/tests/phase1_access.sql`
and `supabase/tests/permanent_game_access.sql` after both migrations. They use
rollback-only fixtures to check owner isolation, raw-table denial, immutable
snapshots, idempotency, singleton restoration, legacy-creation denial, and read-only
viewer permissions. Production migrations and access tests still require execution
on a PostgreSQL/Supabase connection; unit tests do not prove database deployment.

## Acceptance after deployment

1. Open the original host phone. Its indicator turns amber, then green without a form.
2. Tap it and scan the QR using the iPad. Verify its URL is the same read-only link
   as Copy Link and that the current drink/settings/players have survived.
3. Generate a drink and check that it appears on the iPad automatically.
4. Finish it: the display returns to waiting. Generate another and verify it appears.
5. Reload both. The phone attaches to the same game and the iPad reconnects without
   scanning. Existing history and ingredient edits remain.
6. Hide each app, then reopen it. There are no new polls while hidden; it resumes on
   return. Disconnect/reconnect the phone with a queued drink; it uploads once.
7. The QR image is generated locally and remains available offline after the first
   permanent-game connection. No third-party QR service receives the URL.

For a fresh development database only, apply migration 001 then 002, enable anonymous
sign-ins in Auth, and populate `config.js` with the public project URL and publishable
key. The permanent-game flow intentionally requires an existing event to adopt;
new empty projects need trusted administrative provisioning, not public session creation.
No OpenAI, auctions or scoring are added.
