# review guild round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only guild change in the commit range is server/core/guild/tests/query.test.ts:166 (commit 128fd951): SearchGuilds with U+0000 in `name` now expects INVALID_REQUEST, following validator rule `nul` (commit ee58cbae, skills/server-core/modules/validation.md:75 and :172). The test fails when the `nul` rule is absent, because the handler then returns code 0 with an empty list. `ogw core test server guild` passed on this checkout.
- Changes in the range to dependencies (storage seed provider, DB meter and SQLite WAL retry; routing request workers, front link and settings check; logging metrics) were read only where guild calls them (`lock_game_row`, `db`, settings reads in server/core/guild/index.ts). I found no change in guild behavior. I did not check whether `storage.lock_game_row` serializes guild transactions across several request worker threads on one SQLite file: that is storage and routing scope.
- server/core/guild/rpc.ts:186: the `prefix.includes('\u0000')` branch and its comment are now unreachable from the rpc, since the validator rejects U+0000 before the handler runs. Severity is low (unused code), so this is not a finding for a review with a commit range.
- Guild code outside the range and the places it calls was not reviewed again, per step 2 of the procedure.
