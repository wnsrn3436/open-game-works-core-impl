# review: gacha round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | server/core/gacha/index.ts:267 | Debt D1 is still there; the commit range is empty, so the code is unchanged. `draw.items = [...result.items]` copies only the list, so `GachaDrawResult.items` holds the same `ItemAmount` objects as `draws.rolled`. Line 283 passes `rolled` to `grant_gacha_result`, and line 318 saves `draw.items` as the draw record. A hook that changes an input item in place (e.g. sets `item_id` to `[gacha_shard]` and `amount` to 5, as in the D1 reproduction with seed 41 on `[gacha_banner_main]`) therefore also changes `results[0].items` of the response and the `ListGachaHistory` row. `## hook` says those are the drawn result regardless of the hook. `draw.test.ts:198` does not catch it because its hook builds a new list and does not change its input | Give the hook (or the draw result) its own copies of the `ItemAmount` messages, e.g. clone each item in line 267, so a change made by the hook cannot reach `draws.results`. Add a test whose hook changes its input items in place | no | 90 |
| R1-2 | spec | medium | server/core/gacha/index.ts:373 | Debt D2 is still there; the code is unchanged. `on_gacha_drawn` receives `draws.results`, and line 379 puts the same array in the response after the hook returns. `readonly` exists only at the type level, so a hook that runs `results.length = 0` (reached through a cast, as in D2) returns an `OK` response with 0 `results`, while line 309 has already saved 1 draw record. The response then no longer matches the saved draw records, which `## hook` requires to be the drawn result | Give the hook a copy of the list (and of its messages), or build the response list before calling the hook from a separate copy. Add a test whose hook changes its input list | no | 88 |
| R1-3 | test evidence | medium | server/core/gacha/index.ts:260 | Debt D3 is still there. In `server/core/gacha/tests/`, no test makes `loot-table.roll` fail (line 260) or makes `sum_items` fail (line 281; e.g. `AMOUNT_OVERFLOW`). `grep -n "sum_items\|AMOUNT_OVERFLOW"` over the tests finds nothing. So the `## error` row "`loot-table` failure → `INTERNAL`" has no test. D3 reports that all 36 tests still pass with either line changed | Add tests that give the roll a failure (e.g. a loot-table module whose `roll` returns a failure) and a `sum_items` overflow (e.g. a banner whose summed amounts overflow). Each test asserts `INTERNAL` and that nothing changed | no | 88 |
| R1-4 | test evidence | medium | server/core/gacha/index.ts:302 | Debt D4 is still there. No test makes `mailbox.grant_or_mail` return a failure value, so the `## error` row "mail grant failure → `INTERNAL`" has no test. `grep -n "grant_or_mail\|Failed"` over the tests finds nothing. D4 reports that all 36 tests pass when line 302 is changed to return an empty successful grant | Add a test where `grant_or_mail` fails (e.g. a grant list that fails the `item-ledger` input check, made through `grant_gacha_result`). It asserts `INTERNAL` and that the cost, pity and records are unchanged | no | 85 |
| R1-5 | test evidence | medium | server/core/gacha/index.ts:287 | Debt D5 is still there. The `grant_gacha_result` output test at `draw.test.ts:350-382` tries only `GAME_ERROR_CORE_TEST`, `CORE_ERROR_INVALID_REQUEST` and 999. No test gives a wrong output that is not a number (e.g. `'pass'`, an object, or a list with an entry that is not an `ItemAmount`), so lines 286-287 (`granted_items` → `internal` error log) have no test. `core` `## hook` requires an error log and a failed operation for a wrong output form | Add cases such as `[{ item_id: 'x' }]` and `'pass'` to the hook output test. Each asserts `INTERNAL`, the `hook grant_gacha_result returned neither an ItemAmount list nor a GameError` error log, and no change | no | 88 |
| R1-6 | spec | medium | server/core/gacha/index.ts:442 | Debt D6 is still there. `get_pity` is an `## API` operation, including its unknown-banner result `(0, false)`, but `grep -n get_pity` over `server/core/gacha/tests/` finds nothing. `tests/helpers.ts` `pity` reads `GachaPityUserState` directly | Add a test that calls `get_pity` for a banner with pity state, for a `pity_banner` banner (it reads the owner's state) and for an unknown banner (`(0, false)`) | no | 90 |
| R1-7 | test evidence | medium | server/core/gacha/index.ts:229 | Debt D7 is still there. Draw order step 1 checks `GACHA_BANNER_UNAVAILABLE` before `GACHA_BANNER_LOCKED`, but no test banner is both outside its window and locked. In the test `gacha_banner.csv`, `[gacha_banner_locked]` has a null `start_at`, `end_at` and `live_event`, and the window and event banners have an empty `requirement`. Swapping lines 229-231 with line 232 fails no test | Add a banner that is both outside its window and has a failing requirement, and assert `GACHA_BANNER_UNAVAILABLE` | no | 90 |
| R1-8 | test evidence | medium | server/core/gacha/records.ts:132 | Debt D8 is still there. No test asserts the stored `rate_up` of a draw record. `history.test.ts` lists `rate_up` only as a key name (lines 111, 145), and `draw.test.ts` checks `rate_up` only on `DrawGacha` results (lines 136, 138). With `bool` returning `false` for every value, no assert fails (D8) | In the rate-up test (`draw.test.ts:121`), also assert that the `ListGachaHistory` entries (and one `list_gacha_history` row) have `rate_up` `true` for the rate-up round and `false` for the others | no | 88 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `server/core/gacha/index.ts:267` still copies only the list, and line 283 still passes the shared `rolled` items to the hook |
| D2 | open | R1-2 | `server/core/gacha/index.ts:373` and `:379` still pass and return the same `draws.results` array |
| D3 | open | R1-3 | No test in `server/core/gacha/tests/` goes through a roll failure or a `sum_items` failure |
| D4 | open | R1-4 | No test in `server/core/gacha/tests/` makes `grant_or_mail` fail |
| D5 | open | R1-5 | `draw.test.ts:350-382` tries only numeric outputs for `grant_gacha_result` |
| D6 | open | R1-6 | No test calls `get_pity` |
| D7 | open | R1-7 | No test banner is both outside its window and locked (test `gacha_banner.csv`) |
| D8 | open | R1-8 | No test asserts the stored `rate_up` through `ListGachaHistory` or `list_gacha_history` |

## must fix

none

## unknown

- The commit range `f8ed28b..f8ed28b` is empty, so no changed code was reviewed. This round covered only the positions of the input `## debt` items, plus a read of `server/core/gacha/index.ts`, `draw.ts`, `records.ts` and the test files.
- The gacha tests and the mutation runs that the debt items describe were not run again. This checkout and `open-game-works-core-impl/server` have no `node_modules`, so vitest is not available. The open results rest on reading the code and the tests: the code is identical to the commit the debt items were recorded against, and no test was added since.
- The modules gacha depends on (`loot-table`, `item-ledger`, `mailbox`, `storage`, `admin-api`) were not reviewed beyond the calls gacha makes.
