# review rating round 1

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

- The range d4e2728f..c6a11941 does not change `server/core/rating/`, the modules it depends on (`storage`, `ranking`, `mailbox`, `validation`, `logging`, `matchmaker`), `server/generated/` or `test-data/`. The server changes of the range are in `auth` (`server/core/auth/login.ts`, `server/core/auth/deletion.ts`, `server/core/auth/dev/index.ts`), which `rating` does not import, and two new keys in `server/core/testing/dev/setting_types.ts` and `settings/core-settings.json` (`QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`). `rating` tests reach `SETTING_TYPES` only through key lookup (`server/core/testing/dev/test_server.ts:339`), and the new keys are not `rating` keys. No finding came from these changes. The rest of the range is client core, `core-spec/` of client modules and `records/`
- Because the range does not reach `rating`, the code of `server/core/rating/` was not reviewed again for problems that existed before the range
- The `rating` core tests (8 files, 28 tests) were run with vitest only with `OGW_DEFAULT_DB` `sqlite`, on a copy of `open-game-works-core-impl/` at c6a1194 in a temporary folder, with its `server/build/data`. They all passed. The PostgreSQL run was not done, because no PostgreSQL connection was set up for this review
