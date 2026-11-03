# review gacha round 1

## findings

none

## previous

none

## out of scope

- server/core/gacha/index.ts:267: medium `GachaDrawResult.items` and the draw record share their `ItemAmount` objects with the `LootResult` list passed to `grant_gacha_result` (line 283), so a hook that edits a drawn item in place changes the drawn result. The spec says the draw records and the `GachaDrawResult` of the response are the drawn result regardless of the hook. Reproduced with seed 41 on `[gacha_banner_main]` and a hook that sets each item to `([gacha_shard], 5)` and returns those objects: the draw is `OK`, and both `results[0].items` and the `ListGachaHistory` row hold `([gacha_shard], 5)`. The drawn item of that seed is `([gacha_star], 1)` in `draw.test.ts`, where the hook returns a new list. The existing test does not cover this because its hook does not edit its input
- server/core/gacha/index.ts:373: medium `on_gacha_drawn` receives the same `draws.results` array that line 379 puts in the response, so a hook that changes it changes the response and no longer matches the saved draw records. Reproduced with a hook that sets `results.length = 0`, registered through a cast because the hook type marks the list `readonly`: the draw is `OK` with 0 `results` and 1 draw record
- server/core/gacha/index.ts:260: medium `test evidence` no test goes through the `loot-table` failure path that `## error` sets to `INTERNAL`, for `roll` here or for `sum_items` at line 281. With line 260 changed to skip the round, and separately with line 281 changed to return an empty list, all 36 gacha tests pass in a temporary copy. Neither `AMOUNT_OVERFLOW` nor a failing roll appears in `server/core/gacha/tests/`
- server/core/gacha/index.ts:302: medium `test evidence` no test goes through the mail grant failure that `## error` sets to `INTERNAL`. With line 302 changed to return an empty successful grant for every failure value, all 36 gacha tests pass in a temporary copy
- server/core/gacha/index.ts:287: medium `test evidence` no test gives `grant_gacha_result` a wrong output that is not a number, although `core` `## hook` requires an error log and a failed operation for a wrong output format. For that hook, `draw.test.ts` only tries the numeric outputs `CORE_ERROR_INVALID_REQUEST`, 999 and `GAME_ERROR_CORE_TEST`. With line 287 changed to return an empty list, all 36 gacha tests pass in a temporary copy
- server/core/gacha/index.ts:442: medium `spec` `get_pity` has no test: no test file calls it, and the `pity` helper in `tests/helpers.ts` reads `GachaPityUserState` directly. With line 442 changed to always return `(0, false)`, all 36 gacha tests pass in a temporary copy. A separate probe confirmed that the current code returns `(0, false)` for an unknown banner
- server/core/gacha/index.ts:229: medium `test evidence` no test fixes the order of draw order step 1, which is `GACHA_BANNER_UNAVAILABLE` first and `GACHA_BANNER_LOCKED` otherwise. No test banner is both outside its window and locked. With the two checks swapped, all 36 gacha tests pass in a temporary copy
- server/core/gacha/records.ts:132: medium `test evidence` no test checks the stored `rate_up` of a draw record through `ListGachaHistory` or `list_gacha_history`. With `bool` changed to always return `false`, all 36 gacha tests pass in a temporary copy. A separate probe confirmed that the current code returns the drawn `rate_up` on SQLite

## debt

none

## must fix

none

## unknown

- The commit range changes no file in `server/core/gacha/`, in the server modules it depends on, in `server/generated/`, in `test-data/`, in `core-spec/gacha.json`, or in the gacha data check and its test. The changes that reach gacha are `coreDataOf` in `tools/data-tool/src/corespec.ts`, `usedTables` in `core-spec/validation.json` and the core settings files. No problem was found in them for gacha
- Tests run: `ogw core test server gacha` passed on this checkout. That command can reuse a kept passing result with the same key, so this does not show whether both databases ran again in this review. `tests/gacha-check.test.ts`, `tests/corespec.test.ts` and `tests/coredata.test.ts` of the data tool passed in a temporary copy (21 tests)
- Not run: `ogw core test tools` as a whole, including the engine round trip tests, and the core tests of modules that depend on gacha
- The restored defects and probes ran on SQLite only, directly with vitest on a temporary copy. So the `out of scope` evidence and the `rate_up` result were not checked on PostgreSQL. A control change to the pity update made 4 tests fail, which shows that this run used the changed code
- The first mutation run started from outside `worktrees/_core/`, so `ogw core test` ran the unchanged code of the main checkout. That result is not used here
- The specs of `item-ledger`, `mailbox`, `live-event`, `storage`, `server-time`, `logging`, `validation` and `admin-api`, plus `server-core` `SKILL.md`, `core` `SKILL.md` and `core` `command.md`, were read only in the sections that gacha uses. Their other sections were not checked against gacha
- The code of the dependency modules was read only where gacha calls it. It is not reviewed here
- Whether a resend of the same request ID after `idempotency` has dropped its saved response can reach the `AlreadyApplied` path of `grant_draws`, taking the cost again with no grant, was not checked
