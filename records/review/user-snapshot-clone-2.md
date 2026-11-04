# review user-snapshot-clone round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | server/core/user-snapshot-clone/tests/export.test.ts:209 adds `describe('export in PROD')`. It builds the module with `server: { env: 'PROD', ... }` over the storage of the test server and calls the `export_user_snapshot` handler in a user transaction of a source user and the `export_game_state` and `sample_game_state` handlers in a game transaction, each inside `storage.run_read_only`. It asserts `source_environment` `PROD`, records equal to the stored `user_state` rows and the two stored `game_state` rows of `CloneBossGameState`, and an unchanged `dumpDb`. Restoration: in a temporary copy outside the checkout (`git archive HEAD`, with `server/build/data` copied from `open-game-works-core-impl/server/build/data`), `if (server.env === 'PROD') return 'conflict';` was added as the first statement of one handler at a time: `export_user_snapshot` (server/core/user-snapshot-clone/index.ts:351), `export_game_state` (index.ts:475), `sample_game_state` (index.ts:493). In each of the three runs the new test failed (`expected undefined to be 'PROD'`), 1 failed and 80 passed. Without the change all 81 tests passed (OGW_DEFAULT_DB=sqlite) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The same problem as R1-1. The test at server/core/user-snapshot-clone/tests/export.test.ts:209 now calls all three export operations on a PROD module instance, and the restoration named in D1 (the PROD guard at the start of each of the three handlers) makes it fail, each handler separately, as written in `## previous` R1-1 |

## must fix

none

## unknown

- The restoration runs used SQLite only (OGW_DEFAULT_DB=sqlite). PostgreSQL was not run because no PostgreSQL connection string was available outside `ogw core test`. The core agent report states the new test also fails on the restored defect in the PostgreSQL run; that was not checked here
- In the range, only server/core/user-snapshot-clone/tests/export.test.ts changed in this module. The modules it depends on (validation, storage, session, server-time, logging) have no change in the range, so no other code of the module was reviewed again
