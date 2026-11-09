# Phase 2 presentation

The presentation is a 16:9 board, letterboxed on 4:3 iPads and other aspect ratios.
The supplied `assets/presentation/tavern-backdrop.png` stays static and contains the
permanent title. Native serif/sans font stacks avoid third-party font requests.
No dynamic text sits in bordered panels. The central safe area avoids the banners,
candles, dice, cards and tankard in the supplied artwork.

With no active encounter the six-rule welcome scene and three-D20 SVG appear.
An active encounter populates the left side from its saved recipe snapshot; the
right side holds a transparent vector cocktail placeholder. It is labelled as an
illustration, not a depiction of that recipe. Additions and estimated ABV are taken
from the snapshot. Recipe quantities, alcohol calculations and serving counts are
not recalculated by this presentation layer.

`services/presentation-view.js` owns the snapshot-to-view model and keyed transition
coordinator. An encounter change fades the old scene out for 420 ms, then reveals
new content over 650–850 ms with staggered text. Repeated polling and changes to
unrelated server revision metadata do not rerender or restart the scene. Rapid
changes coalesce to the latest encounter. Returning to no active drink restores
welcome automatically. A cached result is restored immediately on refresh.

The one-second read-only Supabase RPC, pairing/storage keys and permanent-game
connection are unchanged. The phone controller and recipe engine are unchanged.
Presentation transition timers, fitting frames and CSS animation activity pause
when hidden/suspended; the existing connection loop continues to control polling.
Reduced motion removes scene transitions and ambient floating.

A measured fit pass adjusts the copy's typography as a unit rather than truncating
names, quantities or commentary. It reruns on resize/font readiness/scene changes,
not every poll. The board never scrolls. Extremely long copy necessarily uses
smaller type; all provided content is retained. The ticker and leader slots are
layout reservations only: there are no fictitious awards, points or history items.
Welcome explains the intended auction rules; it does not implement them.

## Future artwork

`#drink-artwork` is a single contain-scaled image in a dedicated right-hand slot.
The presentation model currently assigns only the bundled placeholder. A future
trusted artwork field can replace `model.artwork` without changing recipe logic,
layout, pairing or permissions. No artwork API, scoring or auction integration is
introduced here.

## Validation and deployment

- 45 Node tests pass, including existing engine/local storage/authentication checks.
- New tests cover exact snapshot rendering, new-ID reveals, repeated polls, coalescing,
  no-active welcome, refresh restoration, reduced motion and hidden transition handling.
- Browser fixture checks were performed at 1920×1080, 1280×720 and 1024×768. Welcome,
  normal drinks and long text fit without document scrolling. The 4:3 board is
  1024×576, centred vertically. Preview fixtures were local-only and removed from
  production output. No Supabase records or sessions were changed by these checks.
- The production build includes the image/SVG assets and updated service-worker
  cache v5. A missing required backdrop causes a build error.
- A live Supabase API check was attempted but the execution environment denied its
  network request. Live end-to-end verification of this release remains pending
  deployment; local fixtures and unit tests do not substitute for that check.

No database migration is required. Commit/push the current source and assets,
wait for GitHub Pages, then close all PWA/controller/display windows and reopen to
activate the new shell. Never clear local storage to install this update.

After deployment: verify the existing iPad link still pairs, generate a drink on
the original phone, wait for its reveal, then advance to welcome. Check that a
stationary drink does not replay its entrance every second and that refresh restores
it. Recheck on the actual mirrored TV for its overscan and preferred text size.
