# review testing round 1

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

- Scope: in the commit range 51d323b47697544eb4b090cd2e284e11390c5688..d73cf33c9288c9b2db8c34293ffb330fe11801f0 the only change under `server/core/testing/` is commit 418298b, which adds the test `send_admin writes the query of a binary body as the query string with URLSearchParams` (server/core/testing/tests/request.test.ts:182). I compared it with the `send_admin` definition (testing.md `## DEV` row `send_admin`, the `send_admin` binary body line and the `send_admin` behavior line) and with the code it calls (server/core/testing/dev/request.ts:334, `start_test_server`, `stop_test_server`). It matches the definition, and there is no finding
- Test evidence check: in a temporary copy of the checkout outside the target, the test passed unchanged (sqlite run). It failed for each of three restored defects in server/core/testing/dev/request.ts:339: (1) the query string built with `encodeURIComponent` per key and value (space gives `%20`, not `+`), (2) the query values joined without encoding, (3) no query string at all
- Changes in other modules in the range (storage `get_states`, `get_user_records`, PostgreSQL adapter waits, user-snapshot-clone tests, test-data tables) belong to other review targets. I did not review them, except to note that the testing dev code does not call the new storage operations
- Test runs used the server build data of `open-game-works-core-impl/server/build/data` (the main checkout, at 448cdc6), because this worktree has no `server/build/data`
- No PostgreSQL connection (`OGW_POSTGRESQL`) was available, so I did not run the postgresql run of the new test. With `OGW_DEFAULT_DB` sqlite, the whole `server/core/testing/tests` suite gave 80 passed and 40 failed. Every failure but one was `testing: DB kind postgresql needs OGW_POSTGRESQL`. The other one, isolation.test.ts:88 `a test server that fails during restart_test_server leaves no temporary folder or open port`, passes when run alone; in the full file run it follows postgresql tests of the same file that failed for the missing connection. I did not check those postgresql tests further
