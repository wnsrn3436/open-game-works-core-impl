# review UnitTestCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:1540 | `open-game-works-core/skills/client-core/modules/unit-test-core.md:229` says that `require_platform` "ends that test as skip" when the platform is not in the list. The implementation only sets `run.test.skip_reason` and returns, so the test function body goes on. `_record` (line 474) reports skip only when the body returns. Run path: a core test calls `require_platform(["no_such_platform"])` and then awaits a signal that never fires. `_on_test_not_returned` (line 522) then calls `_end_run_early`, which records a run failure and stops the remaining tests, instead of recording one skip and going to the next test. The callers avoid this only with their own guard after the call (e.g. `client/godot/core/unit_test_core/tests/test_page_input.gd:45`, `client/godot/core/auth_core/tests/test_plugin_waits.gd:121`, `client/godot/core/sound_core/tests/test_limiter.gd:32`), and no defining document names that guard. `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:7` has only `assert_true(true)` after the call, so no test checks that the rest of the body does not run | On skip, end the test in the runner: record the skip and go to the next test without waiting for the body, and add a sample test whose body after the call never returns or fails. If GDScript cannot stop the body, change the spec instead: `require_platform` returns whether the test goes on, and the caller returns on `false` | no | 90 |
| R1-2 | spec | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:129 | `open-game-works-core/skills/client-core/engines/godot.md:116` says that in `init` a module reads the keys of `## settings` of its spec, and that a missing key or a key of another type gives an error log and a failed `init`. `open-game-works-core/skills/client-core/modules/unit-test-core.md:192` lists `UnitTestCore.startTimeLimitMs` (integer, 1 or more). `_init_failure` checks only `UnitTestCore.testTimeLimitMs` and `UnitTestCore.runTimeLimitMs`. Under `client/godot/core` the key appears only in the comment at `client/godot/core/unit_test_core/dev/unit_test_core.gd:946`. Run path: with `UnitTestCore.startTimeLimitMs` removed from `client/godot/generated/core_settings.json`, or set to a string, `init` returns `true` with no error log. Found by reading, not run | In `_init_failure`, also require `CoreSettings.has_int("UnitTestCore.startTimeLimitMs")` with a value of 1 or more, and add a test in which a missing key or a value of the wrong type fails `init` with an error log | no | 85 |
| R1-3 | test evidence | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:1484 | `## error` rows `put_page_key` with an empty key (`open-game-works-core/skills/client-core/modules/unit-test-core.md:179`, `false` and an error log) and a failed test host request (`open-game-works-core/skills/client-core/modules/unit-test-core.md:177`, failure value and an error log) are not fully tested. `put_page_key` is called only with `"q"` (`client/godot/core/unit_test_core/tests/test_page_input.gd:54`, `client/godot/core/unit_test_core/tests/test_page_input.gd:66`). These branches call `_host_failure`, but no test reaches them or checks the `UnitTestCore` error log: `POST /input` with a status other than 204 and 404 (line 1091), `POST /servers` (line 1404), `PUT /responses` (line 1425), `GET /requests` (line 1441) and `POST /ws-servers` (line 1461). `test_http_server.gd`, `test_ws_relay.gd` and `sample_server_delete.gd` test only the success paths. Only `PUT /started` has a failure test (`client/godot/core/unit_test_core/tests/test_run.gd:503`). Removing the empty-key check or one `_host_failure` call fails no test. Found by `grep` and reading, no mutation run | Add a test in which `put_page_key("")` returns `false` with one `UnitTestCore` error log, and tests in which a test host that refuses each request (e.g. a loopback server from `start_http_server` used as the test host, as in `test_run.gd:503`) gives the failure value and one error log | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `require_platform` at `client/godot/core/unit_test_core/dev/unit_test_core.gd:1540` still only sets `skip_reason`, and the test body goes on |
| D2 | open | R1-2 | `_init_failure` at `client/godot/core/unit_test_core/dev/unit_test_core.gd:129` still does not check `UnitTestCore.startTimeLimitMs` |
| D3 | open | R1-3 | Still no test calls `put_page_key("")`, and none reaches the `_host_failure` branches at lines 1091, 1404, 1425, 1441, 1461 |

## must fix

none

## unknown

- The commit range `7a5b223..7a5b223` is empty, so this round has no changes to review. Only the input `## debt` items were checked
- No test was run. R1-1 to R1-3 were found by reading the code and with `grep`. No mutation was run for R1-3
- No other part of UnitTestCore was reviewed: test setup, clock, input, fake network, fake realtime, WebSocket relay, result file and browser run
