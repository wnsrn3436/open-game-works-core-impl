# review UnitTestCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:1543 | `open-game-works-core/skills/client-core/modules/unit-test-core.md:229` says that `require_platform` "ends that test as skip" when the current platform is not in the list. `require_platform` (lines 1532-1544) only sets `run.test.skip_reason`, so the test body after the call goes on (`client/godot/core/unit_test_core/tests/resources/sample_platform.gd:11` now shows it: its assert failure and error log after the call run, and the test is still recorded as skip). Run path: a core test calls `require_platform(["no_such_platform"])` and then awaits a signal that never fires; `_on_test_not_returned` (line 526) ends the run with a run failure and exit code 1 instead of one skip and the next test. This cannot be fixed in code: GUT runs a test as `await script_inst.call(test_name)` (`addons/gut/gut.gd:622` of GUT 9.7.1, the version in `client/godot/engine.json`) and GDScript has no way to cancel that await or to stop the caller's body from a called function. The callers avoid it only with their own guard after the call (e.g. `client/godot/core/unit_test_core/tests/test_page_input.gd:45`, `client/godot/core/auth_core/tests/test_plugin_waits.gd:121`, `client/godot/core/sound_core/tests/test_limiter.gd:32`), which no defining document names. This is input debt D1 | Change the spec as the core agent report `records/1793821756742-review-fix-mw2j5pvq60885a.md` `## spec proposals` proposes: `require_platform` returns whether the test goes on (`false` when the current platform is not in the list and the test is recorded as skip), and `### run and result file` states that a test returns right after `require_platform` gives `false`. Then make the implementation return that value and the callers use it | yes | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | withdrawn | Answered `disputed`, and the evidence is right: GUT 9.7.1 awaits the test function with `await script_inst.call(test_name)` (`addons/gut/gut.gd:622`, read in the project that `ogw core test` assembles) and has no way to cancel it, and a GDScript function cannot end the function that called it, so the runner fix that R1-1 asked for with `spec change: no` cannot be done. The spec still differs from the code, so input D1 stays open and is written again as R2-1 with `spec change: yes` |
| R1-2 | fixed | `_init_failure` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:136`) now fails `init` when `UnitTestCore.startTimeLimitMs` is missing, not an integer, or below 1. Restored the defect in a temporary detached worktree `worktrees/_core/review-mut-ut2` at `716f069` by deleting the two lines of that check, and ran `ogw core test godot UnitTestCore --file client/godot/core/unit_test_core/tests/test_lifecycle.gd`: `test_init_fails_with_an_error_log_without_a_start_time_limit_of_1_or_more` (`client/godot/core/unit_test_core/tests/test_lifecycle.gd:61`) failed for `missing`, `text` and `zero` (no error log where one was expected) |
| R1-3 | fixed | New tests `client/godot/core/unit_test_core/tests/test_host_failures.gd:7` and `:39`. Restored the defects in the same temporary worktree by deleting the `_host_failure` calls of `POST /input` (line 1095, replaced with `pass`), `POST /servers` (1408), `PUT /responses` (1429), `GET /requests` (1445), `POST /ws-servers` (1465) and the `put_page_key: an empty key` error log (1489), and ran `ogw core test godot UnitTestCore --file client/godot/core/unit_test_core/tests/test_host_failures.gd`: the headless pass failed with `[0] expected to equal [1]` for each of `POST /servers error log`, `PUT /responses error log`, `GET /requests error log`, `POST /ws-servers error log`, `POST /input of a click error log`, `POST /input of a key error log`, and `one error log` in `test_page_key_with_an_empty_key_is_false_with_an_error_log` |

## out of scope

- client/godot/core/unit_test_core/dev/unit_test_core.gd:943: medium The `## error` row "a test host request fails" (`open-game-works-core/skills/client-core/modules/unit-test-core.md:177`, failure value and an error log) has no test for the failure branches of `PUT /result` (line 943), `PUT /released` (line 989) and the `DELETE` of a WebSocket relay at test end (line 1050). Evidence: in a temporary worktree at `716f069`, deleting those three `_host_failure` calls (the last two replaced with `pass`) and running `ogw core test godot UnitTestCore` (whole module) gives `UnitTestCore pass`. No test under `client/godot/core/unit_test_core/tests` calls `_send_result` with a refusing test host, `_send_released` with one (`test_run.gd:441` checks only the success), or ends a test whose relay delete fails (only the server `DELETE` failure is tested, `test_run.gd:113`). These branches existed before the range and were not in input D3

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | `require_platform` at `client/godot/core/unit_test_core/dev/unit_test_core.gd:1543` still only sets `skip_reason`; the body goes on after the call. The finding that wrote D1 (R1-1) is withdrawn because the code fix cannot be done, so it is written again as R2-1 with `spec change: yes` |
| D2 | fixed | none | Same as R1-2 in `## previous`: `init` now checks `UnitTestCore.startTimeLimitMs`, and the test at `client/godot/core/unit_test_core/tests/test_lifecycle.gd:61` fails when that check is removed |
| D3 | fixed | none | Same as R1-3 in `## previous`: `put_page_key("")` and the failure branches of `POST /input` (status other than 204 and 404), `POST /servers`, `PUT /responses`, `GET /requests` and `POST /ws-servers` are tested, and each test fails when its error log is removed. The failure branches of `PUT /result`, `PUT /released` and the relay `DELETE`, which D3 did not name, are written in `## out of scope` |

## must fix

none

## unknown

- Mutation runs were native runs only (`ogw core test godot` without `--web`). The browser run was not run with the mutations
- The failure values in `test_host_failures.gd` (`""`, `false`, empty list, empty relay URLs) were not mutated; only the error logs and the empty-key log were removed
- The unmutated tests of the range were not run by this review; the core agent report says `ogw core test godot UnitTestCore` and `--web` passed
- The changes outside `client/godot/core/unit_test_core/` in the range (server modules, test data, `client/godot/generated/core_settings_types.json` key order) are not part of UnitTestCore and were not reviewed
- Other parts of UnitTestCore that the range does not change or reach (clock, input injection, fake network, fake realtime, WebSocket relay protocol, result file content) were not reviewed again
