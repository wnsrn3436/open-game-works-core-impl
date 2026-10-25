# review: UnitTestCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/unit_test_core/tests/test_run.gd:449 | The spec (`unit-test-core` `### run and result file`) says the run sends `PUT /started` "and waits for its response ... before the test setup of the first test". No test checks that wait. `test_run_sends_started_once_with_its_run_id_before_the_result_of_its_first_test` (and `_assert_ended_early`) read `root.requests` only after the run quit (`support/unit_test_core_test_case.gd:124`), and they check only the order of the requests the test host recorded. Run path with the wait removed: if `dev/unit_test_core.gd:228` is changed to `_send_started(config)` without `await` (or the `await` before `UnitTestCore._begin_run` in `dev/gut_pre_run.gd:15` is dropped), the coroutine still calls `HTTPRequest.request` for `/started` before `_begin_run` returns. `run_root` then calls `gut.test_scripts()` (`unit_test_core_test_case.gd:116`). The first `/result` of `sample_run_time_limit.gd` comes only after the 600 ms run time limit, so `/started` is still recorded first and exactly once, and every assert passes. `gut_pre_run.gd` is not reached by any core test at all, because `run_root` calls `_begin_run` directly (`unit_test_core_test_case.gd:113`) | Add a test that fails when the wait is missing. For example, in `run_root` (or in a dedicated test), right after `await UnitTestCore._begin_run(gut, config)` and before `gut.test_scripts()`, assert that `UnitTestCore.http_requests(host)` already holds exactly one `/started` request whose response was given. Also cover the pre-run hook path: run a nested GUT whose pre-run hook is `gut_pre_run.gd`, or a hook that records its order, so that dropping the `await` in `gut_pre_run.gd:15` lets the first test setup run before the `/started` response and the test fails | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the mutation of R1-1 (dropping the `await` in `dev/unit_test_core.gd:228` or `dev/gut_pre_run.gd:15`) in an engine run. The claim that the existing tests still pass comes from reading the test helpers: requests are read only after the run quits and only their order is checked
- The tool side of `PUT /started` (the start limit `UnitTestCore.startTimeLimitMs`, a page opened again, the load limit of 4 pages) is harness tool code, outside this target. I did not check it
- Other changes in the commit range (AuthCore, ScreenEffectCore, TweenCore, UICore, records) are other targets. I read them only to confirm that they do not change UnitTestCore code
- The browser run path of `_send_started` (`HTTPRequest` in the web export) was checked only by reading the code. The core agent report says both the native run and the browser run passed; I did not run them again
