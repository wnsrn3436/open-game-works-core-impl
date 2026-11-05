# review UnitTestCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:478 | The changed `open-game-works-core/skills/client-core/modules/unit-test-core.md:135` says "A failure in that test, before or after that call, makes it fail, not skip". `_record` checks `state.skip_reason` first (lines 478-480) and records `skip` even when `state.assert_failures` or `state.fail_reasons` are not empty. `_finish_test` (line 677) returns no failure reasons to `unit_test_case.gd:20` when `skip_reason` is set, after it has moved the unchecked error logs and script errors into `fail_reasons` and cleared `run.logs` (lines 667-673), so they are lost. Run path: `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:11` (`require_platform(["no_such_platform"])`, then `assert_true(false)` and an unchecked `LogCore.log_error`) is recorded `skip` with no run failure, and the spec says `fail`. An assert failure before the call is also turned into `skip` by the same line 478 | In `_record`, check failures (assert failures, `fail_reasons`, GUT fail count) before `skip_reason`, so `skip` is recorded only when there is no failure. In `_finish_test`, return the failure reasons whether or not `skip_reason` is set | no | 92 |
| R3-2 | test evidence | medium | client/godot/core/unit_test_core/tests/test_run.gd:318 | The changed `## test` item at `open-game-works-core/skills/client-core/modules/unit-test-core.md:262` says "A core test that fails an assert after `require_platform` gave `false` is recorded as fail". `test_require_platform_skips_a_core_test_and_fails_a_regression_test` asserts the opposite: `status_of(core, "test_requires_another_platform_then_fails") == "skip"` (line 318) and `core.run_failures` empty for the error log after the skip (line 319), and the sample `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:10` says the body "goes on after the call: an assert failure and an unchecked error log after it do not change the skip". So the test passes only on the old behavior and fails on code that follows the changed spec. No test checks the `## test` items about the return value (`false` for a list without the current platform and in a regression test, `true` for a list with it), because `require_platform` returns nothing (R2-1) | Change line 318 to expect `fail` and check that the result message holds the assert failure and the unchecked error log; add asserts on the return value of `require_platform` in `sample_platform.gd` for the three cases, and make `test_requires_another_platform` return right after `false` | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | The spec part of the fix is done: `open-game-works-core/skills/client-core/modules/unit-test-core.md:229` now says `require_platform` returns whether the test goes on, and `:135` says the test returns right after it gives `false`. The code part is not: `require_platform` at `client/godot/core/unit_test_core/dev/unit_test_core.gd:1532` is still `-> void`, and its early returns for `_check` failure (line 1534), a regression test (1538) and outside a test (1541) give no `false`. The callers cannot use the value. `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:6` and `:12` do not return after the call, and `client/godot/core/unit_test_core/tests/test_page_input.gd:45` and `:63` still use their own platform guards. Run path as in D1: a core test that awaits a signal that never fires after `require_platform(["no_such_platform"])` still ends the run through `_on_test_not_returned` with a run failure |

## out of scope

- client/godot/core/game_update_core/tests/test_web_downloader.gd:35: medium `test_redirect_and_size_limit_over_real_http`, `test_cancel_ends_the_download_once` (line 74) and `test_stall_timeout_over_the_fetch_downloader` (line 95) call `require_platform(["web"])` and do not return after it, so in a native run the web-only body runs (e.g. `_page_eval` of `window.ogwGameUpdateFetch` and the fetch downloader asserts against the `HTTPRequest` downloader). Today the skip hides the failures (R3-1). Under the changed `open-game-works-core/skills/client-core/modules/unit-test-core.md:135` these tests fail in native runs. This is a GameUpdateCore test, outside this target

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | The spec now names the guard: the test returns right after `require_platform` gives `false` (`open-game-works-core/skills/client-core/modules/unit-test-core.md:135`, `:229`). But `require_platform` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1532`) still returns `void`, so a test cannot follow that rule with its value, and `client/godot/core/unit_test_core/tests/resources/sample_platform.gd:6` still goes on after the call. R2-1, which wrote this item again in round 2, is `open` in `## previous` |

## must fix

none

## unknown

- No test was run in this round. R3-1 and R3-2 come from reading `_record`, `_finish_test`, `unit_test_case.gd:20`, `sample_platform.gd` and `test_run.gd:315`. The current tests already show the recorded `skip` for a failure after the call (`test_run.gd:318`)
- No UnitTestCore code changed in the commit range. The range changes SceneCore, VirtualPadCore, BadgeCore, PaymentCore and server modules, which are not part of this target and were not reviewed
- The other parts of the `## spec changes` diff (`godot.md` SceneCore, CameraCore, LocalizationCore, NativeUiCore rows, `input-core.md`, `realtime-core.md`, `ui-core.md`) do not define UnitTestCore behavior and were not checked against UnitTestCore code. The godot.md `UnitTestCore` row (initial device time `1700000000000`) did not change
- `require_platform` callers outside `client/godot/core/unit_test_core/` were read only for a return right after the call. Those modules are not this target, and only the GameUpdateCore one with no guard is written in `## out of scope`
- The round-2 `## out of scope` item (no test for the failure branches of `PUT /result`, `PUT /released` and the relay `DELETE`) was not checked again. It is not an input item of this round
