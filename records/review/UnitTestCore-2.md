# review: UnitTestCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/unit_test_core/tests/support/unit_test_core_test_case.gd:151` follows every `HTTPRequest` added to the tree and `:154` takes the response codes that had ended when GUT emits `start_run`. In GUT 9.7.1 (`addons/gut/gut.gd:762`-`768`) `start_run` comes right after the awaited pre-run hook and before the first `before_each` (`gut.gd:612`). `client/godot/core/unit_test_core/tests/test_run.gd:466` asserts those codes are `[204]`, on the direct `_begin_run` path (`test_run.gd:450`) and on the `dev/gut_pre_run.gd` path (`test_run.gd:458`). I restored the defect in two temporary worktrees of aa85245 outside this checkout and ran `ogw core test godot UnitTestCore --file client/godot/core/unit_test_core/tests/test_run.gd` in each. (1) In `dev/unit_test_core.gd:233` I changed `await _send_started(config)` to `_send_started(config)`. Both `test_run_sends_started_once_with_its_run_id_before_the_result_of_its_first_test` and `test_pre_run_hook_waits_for_the_started_response_before_the_first_test_setup` failed with `[] != [204]`. (2) In `dev/gut_pre_run.gd:15` I removed the `await` before `UnitTestCore._begin_run`. `test_pre_run_hook_waits_for_the_started_response_before_the_first_test_setup` failed with `[] != [204]`. The same file passed unmutated |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I ran the mutation checks only in the native run, because `--file` cannot be used with `--web`. I did not run the browser run (`--web`). Its pass comes from the core agent report
- The new DEV static `UnitTestCore._test_run_config` (`dev/unit_test_core.gd:74`, `:184`) is private and is set only by core tests. I checked it only by reading the code: I saw no path outside the tests that sets it. In the pre-run hook test, `_read_run_config` returns early, so that test does not exercise reading the `-gconfig=` file or the page URL query. This change does not touch that reading, and I did not check whether other tests cover it
- The changes in the commit range to other targets (auth, ScreenEffectCore, records of other reviews) are out of this target. I read them only to confirm that they do not change UnitTestCore code
