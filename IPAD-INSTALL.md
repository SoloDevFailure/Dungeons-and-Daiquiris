# iPad Home Screen pairing and Kraken update — release 11

## Deploy and recover the existing icon

Commit/push these changes through GitHub Desktop and wait for Pages deployment. No SQL migration is needed for this release. Close the display's existing Safari/app windows and reopen online so the updated worker can activate. Look for **v11** in the display footer.

For the existing iPad Home Screen icon, tap **PAIR DISPLAY**, paste the **full read-only presentation link** copied from the phone connection panel, and press **CONNECT DISPLAY**. The app saves the pairing after a successful server response and reconnects when reopened. There is no need to remove the icon, clear site storage, or reset the game. Do not clear the controller's data: it holds the anonymous host identity.

For a new installation, open the current QR link, wait for a live connection, then use Add to Home Screen. The pairing panel says **Paired. You can now use Add to Home Screen from this page** once the personalised install metadata is ready. If an older worker has not activated yet, close/reopen the page. The paste-once flow remains available for installations whose launch URL was saved without pairing details.

## Implementation

The static manifest previously launched plain `presentation.html`, while the read capability lived only in the QR fragment/Safari local storage. A Home Screen app cannot rely on inheriting that local storage. After a verified presentation read, the page asks its controlling worker for personalised install metadata. The worker validates the source page and destination, rebuilds a launch URL containing only session ID/view token in the fragment, and stores a same-origin manifest response locally. No privileged host credential is included and no capability is placed in a server query string or public repository file.

The installed start URL can therefore bootstrap an empty storage container. Existing icons can instead pair within their own container once. Invalid links never replace verified pairing. Normal updates stay read-only and once per second while visible. A foreground visibility event clears stale suspension flags, even if pageshow/resume was omitted; hidden pages remain paused.

The personalised manifest cache is kept separately from replaceable release-shell caches. Relative manifest scope, icons and app ID still resolve within the existing app directory. No new game or Supabase session is created. All public assets/scripts/QR release links use version 11.

## Rum replacement

Slot 9 is now **Kraken Black Spiced Rum**, with **40% reference ABV**, a 15 mL requested default and normal spirit metadata. Verify/edit ABV to match the actual bottle. It no longer has the 151 preset's overproof tags or 5 mL metadata cap. It follows the existing **15 mL per hard spirit / 30 mL combined / 90 mL total** rules. A default three-spirit blend can use 10 mL of each, without the old overproof-triggered reduction or rejection.

Only the retired slot-9 name `151 Rum` is upgraded automatically. A saved 75.5% reference (or missing ABV) becomes 40%; a deliberately edited ABV and requested quantity are retained. Custom names remain untouched. The original configuration is backed up at `dungeons-daiquiris.ingredients.before-kraken.v1` before writing the upgrade. If storage cannot be written, the upgraded inventory remains usable in memory with a warning; previous data is not erased.

The existing owner sync upgrades the same retired preset in shared ingredient configuration, preserving other slots and backing up shared configuration locally at `dungeons-daiquiris.shared-ingredients.before-kraken.v1`. It uses the existing config outbox/RPC. Old drink snapshots, ABV calculations, points, history and active recipes are not edited. Skip an already-generated 151 candidate and generate a new recipe to use Kraken.

Safety/compatibility checks remain for deliberately configured overproof ingredients and unsuitable combinations. Condiments remain sparse; this change avoids overproof reductions by replacing the alcohol rather than hiding its ABV.

## Verification limits

Automated tests cover fresh/empty app storage, embedded start URLs, paste-once pairing, remembered pairing, rejected origins/incomplete links, manifest validation, release asset caching, foreground recovery and rum migration/pour math/history preservation. Local browser QA verified pairing from a bare launch URL, live mock polling, remembered pairing on reload and successful generation of the same-origin install manifest.

The native iPadOS Add to Home Screen UI is not available in this environment. That final device check remains: after deployment, launch from the icon, generate a new drink on the phone, then background/reopen the display and confirm it updates again.
