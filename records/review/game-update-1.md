# review game-update round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/game-update/tests/publish.test.ts:77 | Debt D1 is still there. `publish` and `prune` call `storage.lock_game_row` at server/core/game-update/admin.ts:149 and :168, and the handler bodies contain no `await`. Both concurrency tests (publish.test.ts:77 with `Promise.all` of two publishes, :231 with publish and prune) send both operations to one server instance in one process, so the two handler bodies run one after another even when no lock is taken. No game-update test fails when those two `lock_game_row` calls are removed | Run the two operations in two server processes, or on two connections that really interleave in one game transaction each, on PostgreSQL. Assert different `sequence` values and the `conflict` / kept-files result, so that removing either lock makes the test fail | no | 85 |
| R1-2 | test evidence | medium | server/core/game-update/index.ts:101 | Debt D2 is still there. `read_secret` reads the secret named by game settings `environments.<ENV>.secrets.<key>` only when `server.db === null` (lines 102-103). `tests/helpers.ts` `launch` always builds the server with `test_server(db, ...)` with a non-null `db` and passes `secrets` keyed by `updateSigningKey` / `cdn`, so lines 102-103 never run in any test. Replacing them with `return server.read_secret(key)` makes no test fail | Add a start test on a server input with `db` `null` where the host secret named by the setting holds the key: it starts, and with a setting naming a missing secret it fails | no | 90 |
| R1-3 | test evidence | medium | server/core/game-update/index.ts:120 | Debt D3 is still there. `server-core` `## adapter` says the server does not start when the `cdn` secret cannot be read. `tests/start.test.ts:34` covers only `updateSigningKey`. The only `cdn-r2` start test (tests/cdn-adapter.test.ts:93) gives `cdn: 'secret-4'`, and no test calls `start_failure` with `adapters.cdn` `cdn-r2` and no `cdn` secret. Removing line 120 makes no test fail | Add a `start_failure` test with `environments.<ENV>.adapters.cdn` `cdn-r2`, complete `cdnR2` and no `cdn` secret, and check the start failure and its `error` log | no | 90 |
| R1-4 | test evidence | medium | server/core/game-update/routes.ts:54 | Debt D4 is still there. `### serving` of `game-update.md` sets `Content-Type: application/json` on `GET /update/deploy_list.json` and `GET /update/deploy_list.json.sig`. The only content type assert is tests/serving.test.ts:34, on a file response (`application/octet-stream`). No test reads `content-type` of either deploy list response, so changing the value at routes.ts:54 makes no test fail | Assert `content-type` `application/json` on both deploy list responses, for example in the `Cache-Control` test of tests/serving.test.ts | no | 92 |
| R1-5 | test evidence | medium | server/core/game-update/index.ts:185 | Debt D5 is still there. `## API` of `game-update.md` sets failure value `false` for `is_data_update_ready`. The `try`/`catch` at index.ts:185-190 turns a throwing `cache.current()` (a DB read that throws in `DeployListCache.refresh`, server/core/game-update/cache.ts:56) into `false`. No test makes that read throw: tests/data-update.test.ts and tests/cache.test.ts use only reads that return a row or `null`. Removing the `try`/`catch` makes no test fail | Add a test where the first deploy list read throws (for example a DB that fails the read through the storage DEV code, or a closed DB) and assert `false` and the `error` log | no | 88 |
| R1-6 | efficiency | medium | server/core/game-update/store.ts:62 | Debt D6 is still there. `file_sizes` runs one `SELECT size ... WHERE sha256 = $1` per distinct `sha256` (store.ts:62-63), and `uploaded_sha256s` does the same at :114-115. `files_match` calls `file_sizes` in `prepare_publish` (admin.ts:132) and again in `publish` (admin.ts:151) inside the game transaction while holding the `sequence` 0 lock. The number of queries grows with the number of file entries of the input, which only `admin-api.maxBodyBytes` limits | Read the sizes, and the upload records, of all `sha256` values with one query per call (`WHERE sha256 IN (...)` or `= ANY`), in chunks when there is a parameter limit | no | 85 |
| R1-7 | efficiency | medium | server/core/game-update/admin.ts:175 | Debt D7 is still there. `prune` reads every `sha256` of `game_update_file` (`store.file_sha256s`, store.ts:76-77) and runs one `DELETE` per unreferenced file (`store.delete_file`, admin.ts:177) inside one game transaction while holding the `sequence` 0 lock, so publishes wait for it. The number of statements grows with the number of stored files and of files to delete | Delete the unreferenced files with one statement (or a few in chunks), such as `DELETE ... WHERE sha256 NOT IN (...)` over the kept set, and count with the affected rows | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | server/core/game-update/admin.ts:149 and :168 are unchanged, the handlers still have no `await`, and tests/publish.test.ts:77 and :231 still run both operations on one server instance in one process |
| D2 | open | R1-2 | server/core/game-update/index.ts:101-103 is unchanged, and tests/helpers.ts `launch` still always gives `test_server` a non-null `db` |
| D3 | open | R1-3 | server/core/game-update/index.ts:120 is unchanged. No test uses `start_failure` with `adapters.cdn` `cdn-r2` and a missing `cdn` secret |
| D4 | open | R1-4 | server/core/game-update/routes.ts:54 is unchanged. The only `content-type` assert in the game-update tests is tests/serving.test.ts:34, on a file response |
| D5 | open | R1-5 | server/core/game-update/index.ts:185-190 is unchanged. No test makes the deploy list read throw |
| D6 | open | R1-6 | server/core/game-update/store.ts:62-63 and :114-115 still query once per `sha256`, and admin.ts:132 and :151 still call `files_match` twice |
| D7 | open | R1-7 | server/core/game-update/admin.ts:175-178 still deletes one file per statement under the `sequence` 0 lock |

## must fix

none

## unknown

- The commit range 859a458..859a458 is empty, so there are no changed places. The review read the debt positions, the code they call and the tests that cover them (index.ts, routes.ts, store.ts, admin.ts, cache.ts, tests/helpers.ts, tests/publish.test.ts, tests/serving.test.ts, tests/start.test.ts, tests/cdn-adapter.test.ts, tests/cache.test.ts, tests/data-update.test.ts). The rest of the module (deploy_list.ts, signing.ts, adapters/, dev/) was not read again
- The defects of D3 and D4 were restored in a temporary copy, but the copy could not run the game-update tests outside `ogw core test`: the tests need the runner inputs that ogw sets (server data, fixtures), and with only `OGW_DEFAULT_DB=sqlite` set almost every test fails at setup. So R1-1 to R1-5 rest on reading the test code and on the restore runs written in the input debt items, not on a new run in this round
- The query and statement counts of R1-6 and R1-7 were read from the code. Time was not measured
