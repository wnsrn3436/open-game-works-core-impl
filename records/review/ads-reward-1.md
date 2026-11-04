# review: ads-reward round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | open-game-works-core/skills/server-core/modules/ads-reward.md:80 | Input debt D1 is still present. Lines 80 and 81 of the spec define two checks on a callback whose signature matched (reward notify ID / user ID format → `warn` log; `ads-admob` ad unit not in `adUnits` → `security` log `ad_callback_ad_unit`) without an order between them, and the error table (lines 147, 160) lists both without precedence. The code runs the format checks first (`server/core/ads-reward/callback.ts:176`-`186`, then the ad unit check at `callback.ts:188`), so a signed AdMob callback with `ad_unit=333` (not in `adUnits`) and `custom_data=x` leaves only a `warn` log and no `ad_callback_ad_unit` security line; an implementation that checks the ad unit first leaves the `security` line instead. Both satisfy the current spec | Name the order in the spec (e.g. ad unit check before the reward notify ID and user ID format check, so every callback of another publisher's ad unit leaves `ad_callback_ad_unit`), then align `check_signed` and add a test with a callback that fails both checks | yes | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The spec lines 80-81 are unchanged at the harness HEAD and still set no order; `server/core/ads-reward/callback.ts:174`-`192` (`check_signed`) still runs the reward notify ID and user ID format checks before the ad unit check |

## must fix

none

## unknown

- The commit range `72e3a2d..72e3a2d` is empty, so no code change was in scope; only the code positions of input `## debt` D1 (`server/core/ads-reward/callback.ts` `check_signed`, `handle_callback`, `process`) and the spec lines it names were read. The rest of the module (`grant.ts`, `tickets.ts`, `adapter.ts`, `adapters/`, `dev/`, `index.ts`) and its tests were not reviewed
- No tests were run, since no finding required restoring a defect or checking a failure
