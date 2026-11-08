# update core: testing

## done

- `testing` (server), commits `7bd728a4` and `3bb74525` on `agent/mw7vvwpv619f6c`
  - `start_local_server` (`server/core/testing/dev/local_server.ts`, exported from `dev/index.ts`). It parses the server start arguments with `parse_server_args` of `core/start.ts`. A parse failure, `--env` other than `LOCAL`, or `--ops-port` throws `StartFailure` before anything listens. It reads `generated/server_modules.json`, `generated/core_settings.json`, `build/data/`, `register` of `main.ts` and `registerDev` of `dev/main.ts` (when that file exists) from `process.cwd()`. It makes one server instance with `routing.create_server` (DEV code, log lines to stdout), sets the check seed provider with `storage.set_seed_provider` before `start()`, and runs until `SIGTERM`/`SIGINT`, then stops. A start failure throws `StartFailure` with the start log lines in `logs`
  - check seed provider `check_seed_provider(base)`: per user ID and request name, the k-th new request ID gets `make_purpose_seed(name, base + k)`, and a request ID that came before gets its first seed. Request ID `''` (`make_seed`) counts per purpose name. `base + k` wraps modulo 2^64
  - test record (`dev/test_record.ts`): with `OGW_TEST_RECORD` set, each line goes in one `appendFileSync` call
    - `admin_operation`: per content admin operation that `register` registered (`register` gets a `core.routing.register_admin_operation` that records the name), at each successful start of `start_test_server`, `restart_test_server` and `start_peer_server`
    - `admin`: per `send_admin`, with the HTTP status
    - `game_error`: per `send`/`send_cheat` whose error `code` is 1000 or more, with the `GameContract.GameError` member name, or its decimal string when it has none
  - The test server's seed provider is typed as `storage.SeedProvider`. It returns none for request ID `''`, so `make_seed` stays secure random on a test server
  - New tests:
    - `tests/local-server.test.ts`, with helpers in `tests/local_support.ts`: two processes with random base 7, with other users and request names in between on one of them; the resend after a rollback with `INTERNAL`; the resend after a commit (seed null); base 8; 1 and 2 `routing.requestWorkers`; `GET /update/deploy_list.json` and exit after `SIGTERM`; `--env DEV` and `--ops-port` throw `StartFailure` and leave no listener; check seed provider `match`/`room`/`match` and the modulo 2^64 wrap
    - `tests/test-record.test.ts`, with `tests/record_main.ts`: lines at start and restart, the `GameError` line only, the `admin` line, whole lines from two processes appending 2000 lines of 9 KB each, and no file without `OGW_TEST_RECORD`
- Last runs on `3bb74525`: `ogw core test server testing` pass (sqlite and postgresql). `ogw core dependents testing` lists only `server: testing`. `ogw code check core`: type check, lint, dependency and secret all pass
- No other module's code changed. `logging/tests/helpers.ts` still passes a provider of the request ID only. A function with fewer parameters can be assigned to `SeedProvider`, and those tests do not use the user ID or request name, so it was left as it is
- The coverage judgement (the run failures `admin operation <name> is sent by no test`, `<request name> <GameError> is received by no test` and `test record line <n> is malformed`) happens in the harness tool after a full server regression test run (`### test run`: "the harness tool reads its test record"). It is not core code, and it is not done here
- No engine-specific implementation rules document. `## <engine> build` of `tools/ogw.md` was not written

## flaky tests (background.test.ts, isolation.test.ts)

How it was reproduced: `ogw core test server` (all modules) ran beside up to 6 parallel `--file` runs of the two files. Temporary instrumentation, removed before the commits, recorded each start wait (`wait_idle` of `test_server.ts`): the time of each step, the event loop lag, and the length of each job run.

- `background.test.ts`, "a job run of server start that does not end within testing.backgroundWaitTimeoutMs" (the earlier failure was on SQLite, 1000 ms)
  - Cause: the restart and peer cases give the 1000 ms limit to a test server whose first start must succeed (`holding` false). A LOCAL start waits for the server start job runs of every module in the server module list: all 42 here. Under load, that wait took 263–603 ms of the 1000 ms limit (12 waits in the log). The time was DB work, not a blocked thread (event loop lag ≤ 11 ms in those waits). It was mostly `storage_sweep`: `sweep_expired` runs one autocommit DB transaction per table with an expiry column, 20 tables one after another, up to 617 ms. Under heavier load, timers in test workers fired up to 4 s late (a 10 000 ms limit fired at 14 075 ms), so the host was starved of CPU. That is enough to push this real DB work past 1000 ms, and the setup start then throws `wait_background did not end within 1000 ms`, which is not the step under test
  - Fix (test): the three timeout cases start their test servers with the server module list of `testing` and its dependencies (14 modules: `admin-api`, `auth`, `cheat`, `game-update`, `idempotency`, `item-ledger`, `logging`, `mailbox`, `routing`, `server-time`, `session`, `storage`, `testing`, `validation`). The start that must succeed then holds only the job runs of those modules. No time value changed
  - Check: the same load run was repeated after the fix (full server run plus 3 parallel runs of each file). No successful 1000 ms start wait took more than 250 ms; before, 12 took 263–603 ms. All runs passed
  - Not airtight: the success path still does real DB work (the job runs of 14 modules) under a 1000 ms real-time limit. A much more loaded host than this one can still go past it
- `isolation.test.ts`, "a test server that fails during restart_test_server leaves no temporary folder or open port" (PostgreSQL, 10 000 ms): **not reproduced and not fixed**. It passed in every round (4 + 6 + 6 + 3 runs under load). What was found:
  - The throw comes from the first `start_test_server()` (default 10 000 ms). The restart fails in `register`, before any job runs
  - Experiment, temporary and removed: every new PostgreSQL connection went through a TCP proxy in a child process that delays each connect. The proxy has to run in another process, because `storage` opens the read connection with a synchronous call that blocks the main thread. With 1 s per connect, the start took 5.6 s, with 4 connects one after another. With 4 s per connect, the start took 17.4 s, and its start wait took 4.2 s, all of it in `storage_sweep`: its first delete needed a new pool connection. So the start wait pays at least one new PG connect plus 20 sequential deletes
  - The record of the earlier cheat review (`records/review/cheat-1.md`) shows `cannot connect to PostgreSQL: the connect to PostgreSQL went over its time limit` together with `wait_background did not end within 10000 ms` in the same PostgreSQL run. So in that run, PG connects took about the 5000 ms `storage.dbAnswerWaitMs` or longer
  - One slow connect per start wait does not explain a full 10 s by itself. It would also take more than one slow connect inside the wait, or slow deletes on top of it. That was not shown. Nothing was changed for this test

## spec proposals

- `testing` `## test`, the `start_local_server` item "answers `GET /update/deploy_list.json`": on the new DB of the test, `game-update` answers HTTP 404 (no deploy list stored). The test expects 404. Proposal: state the expected answer (404 on a new DB) in the item
- `start_local_server` writes nothing when it starts listening and returns only after it stops. So the runner, and this module's test, can only learn that it is ready by polling the port (`wait_listening` in `tests/local_support.ts` polls `GET /update/deploy_list.json` every 50 ms). Proposal: have the spec name a readiness signal for a `start_local_server` process (e.g. one stdout log line after `start()` succeeded), or state that the runner polls

## review

none

## unverified

- The cause of the `isolation.test.ts` failure, as above. It was not reproduced, and nothing was changed for it
- That the line appends of the test record never mix: tested with two processes on the local APFS volume, 2 × 2000 lines of 9 KB. Other file systems and vitest thread workers in the same process were not tested
