# review testing round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | server/core/testing/tests/local-server.test.ts:153 | The `it.each` cases `--env DEV` and `--ops-port` call `start_local_server` in the vitest process, whose cwd (`server/` or the checkout root of the core) has no `generated/server_modules.json`, `generated/core_settings.json` or `main.ts`. If the `--env` check (server/core/testing/dev/local_server.ts:133) or the `--ops-port` check (local_server.ts:134) is removed, `read_local_files(process.cwd())` throws and is turned into `StartFailure` (local_server.ts:136-140), so both cases still pass and listen on no port. Reproduced: in a `git worktree add --detach` copy of HEAD, deleted both lines 133 and 134 of local_server.ts and ran `ogw core test server testing --file server/core/testing/tests/local-server.test.ts`: result `testing pass`. Spec `## test` item 295 (testing.md:295) asks that these arguments throw `StartFailure` because of the `--env` / `--ops-port` rule | Run the two cases where every other start input is valid, so that only the checked argument can make the start fail: e.g. call `start_local_server` through the driver in a `local_game` folder with `local_args(game, port)` plus `--ops-port <free port>`, and with the env replaced by `DEV` (without `--db`/`--secret-file`), and assert the `StartFailure` message names the rule (`--env LOCAL` / `--ops-port`) and the port does not answer | no | 95 |
| R1-2 | spec | medium | server/core/testing/tests/test-record.test.ts:55 | Behavior written in the defining documents that this range added with no test: (1) a `game_error` line per `send_cheat` whose response is a `GameError` (testing.md:255; request.ts:249) — test-record.test.ts sends only `send`; (2) an `admin_operation` line at each `start_peer_server` (testing.md:253; recorded in `start_instance`, test_server.ts:159) — only `start_test_server` and `restart_test_server` are checked; (3) `start_local_server` stops on `SIGINT` (testing.md:91; local_server.ts:117) — local-server.test.ts sends only `SIGTERM`; (4) a server start failure of `start_local_server` throws `StartFailure` with the start log lines (testing.md:91; local_server.ts:164-171) — no test makes the server start itself fail (the only `StartFailure` cases fail before a server instance is made, see R1-1). Each of these code paths can be removed without any testing test failing | Add tests: a cheat handler (via `registerDev`) returning a `GameError` and `send_cheat` appends one `game_error` line; `start_peer_server` on a test server whose `register` registers a content admin operation appends one more `admin_operation` line; a driver process that gets `SIGINT` ends with exit code 0 and the `stopped` line; a driver in a game folder whose settings fail the settings check (e.g. `routing.requestWorkers` 0) prints a `StartFailure` with the reason and listens on no port | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Changes of the commit range outside `server/core/testing/` (routing server process, storage seed source and metrics, settings schema, contract tool) were read only where testing calls them (`parse_server_args`, `create_server` settings check and `dev`, `process_input.ts`, `register_admin_operation`, `set_seed_provider`, `make_seed`); they are reviewed under their own targets
- The whole testing test suite and the PostgreSQL run were not run; only `local-server.test.ts` was run, on a copy with the defect of R1-1 restored, with the default DB kind of `ogw core test`
- Whether `appendFileSync` with flag `a` keeps lines whole on file systems other than the local one of this host (e.g. network file systems) was not checked; the two-process test covers the local file system only
- `free_port` in tests/local_support.ts closes the port before the driver listens on it; whether another process can take it in between under load was not checked
