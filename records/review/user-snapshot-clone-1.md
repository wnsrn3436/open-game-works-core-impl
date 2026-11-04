# review user-snapshot-clone round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/user-snapshot-clone/tests/export.test.ts:23 | Spec `### export_user_snapshot` says "It can be called in every environment", and `### game state snapshot` says the same of `export_game_state` and `sample_game_state`. Exporting from PROD is the purpose of the module. No test calls these operations on a PROD server. The only PROD module instance in the tests is in server/core/user-snapshot-clone/tests/import.test.ts:431, and it calls only `import_user_snapshot.prepare` and `import_game_state.prepare`. Every other test runs the LOCAL test server. Run path: in a temporary copy outside the checkout, `if (server.env === 'PROD') return 'conflict';` was added as the first line of the handler functions of `export_user_snapshot`, `export_game_state` and `sample_game_state` in server/core/user-snapshot-clone/index.ts. All 80 tests of server/core/user-snapshot-clone/tests (OGW_DEFAULT_DB=sqlite) still passed, as they did without the change (input D1) | Add a test that builds the module with `server: { env: 'PROD', ... }` over the same storage (as import.test.ts:420 does). It should call the `export_user_snapshot` handler in a user transaction of a source user, and the `export_game_state` and `sample_game_state` handlers in a game transaction. It should assert that each returns a snapshot whose `source_environment` is `PROD` and whose records equal the stored rows, and that the rows do not change | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The commit range f8ed28b..f8ed28b is empty, so the module and its tests are unchanged. `grep PROD server/core/user-snapshot-clone/tests` finds only snapshot.test.ts:17 (a fixture field) and the import-only PROD test at import.test.ts:413-443. The restoration run described in R1-1 was repeated in this round: with the PROD guard added to the three export handlers in a temporary copy, all 80 tests still pass |

## must fix

none

## unknown

- The commit range f8ed28b..f8ed28b has no commits, and `## spec changes` is `none`. Apart from input D1, this round reviewed no code for findings. The module was not reviewed again as a whole, so `## out of scope` covers only what was seen while checking D1
- The restoration run used the SQLite run only (OGW_DEFAULT_DB=sqlite). The PostgreSQL run was not done because no PostgreSQL connection string was available outside `ogw core test`. The test data folder `server/build/data` was copied from `open-game-works-core-impl/server/build/data`, because this checkout has no build of it. Without the change, all 80 tests passed with that data
