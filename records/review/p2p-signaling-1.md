# review p2p-signaling round 1

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

- The commit range cf89b7fd..4e092bc changes no file under `server/core/p2p-signaling/`, `server/core/server-time/` or `server/core/logging/`. It does change files that p2p-signaling uses only through its tests or settings: `server/core/storage/` (the test helpers start `storage` for `logging`), `settings/core-settings.json` and `server/core/testing/dev/setting_types.ts` (new keys `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, changed `routing.ipRateLimitPerMinute`), and `server/core/routing/` (storage sweep job). None of these changes a value or an operation that `server/core/p2p-signaling/index.ts` or `server/core/p2p-signaling/sessions.ts` reads
- The p2p-signaling core tests (`server/core/p2p-signaling/tests/`, 6 files, 24 tests) were run with vitest from the harness tools, `globals: true`, `OGW_DEFAULT_DB=sqlite`, and the server build data folder of `open-game-works-core-impl/server/build/data`, because this checkout has no `server/build/data`. All 24 passed. The `OGW_DEFAULT_DB=postgresql` run was not done: no PostgreSQL instance was running on this host. `ogw review run` runs both
- The whole module was also read against `## behavior`, `## error`, `## settings` and `## test` of the spec, to look for problems that existed before this range. None was found with confidence 80 or more
