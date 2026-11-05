# review UnitTestCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_record` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:478`) now checks GUT fail count, assert failures and `fail_reasons` before `skip_reason`, so a skipped test with a failure before or after `require_platform` is recorded `fail` (`open-game-works-core/skills/client-core/modules/unit-test-core.md:135`). `_finish_test` (line 677) returns `state.fail_reasons` whether or not `skip_reason` is set, so the unchecked error logs it moves into `fail_reasons` are kept. Checked by `test_require_platform_skips_a_core_test_and_fails_a_regression_test` (`client/godot/core/unit_test_core/tests/test_run.gd:316`) with the samples `test_fails_then_requires_another_platform` and `test_requires_another_platform_then_fails` (`client/godot/core/unit_test_core/tests/resources/sample_platform.gd:17`, `:23`) |
| R3-2 | fixed | `test_run.gd:316-347` now expects `fail` for a failure before and after the skip, checks that the message holds the assert failures and the unchecked error log, and checks the return value of `require_platform` through `PLATFORM.returned`: `false` / `false` / `true` in the core run and `false` for all three in the regression run. Restored in a `git clone --shared` copy of commit `75e3534` under `worktrees/_core/` (deleted after): (1) `_record` with the `skip_reason` branch put back before the failure branch: `ogw core test godot UnitTestCore --file client/godot/core/unit_test_core/tests/test_run.gd` failed `test_require_platform_skips_a_core_test_and_fails_a_regression_test` with `["skip"] expected to equal ["fail"]: a failure before the skip` and `... a failure after the skip`, and the message asserts for `an assert failure after the skip` and `an error log after the skip`; (2) `require_platform` with the `return false` after setting `skip_reason` removed (it gives `true`): the same test failed on the `returned` dictionary (`test_requires_another_platform: true`) and on `["fail"] expected to equal ["skip"]` with message `the body after false ran` |
| R2-1 | fixed | `require_platform` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1531`) is `-> bool` and gives `false` for a `_check` failure (1533), a regression test (1537), outside a test (1540) and a platform outside the list after recording the skip (1544), `true` otherwise, as `unit-test-core.md:229` and `:180` say. The callers in the target return right after `false`: `sample_platform.gd:9-12`, `test_page_input.gd:44`, `:61`. The return-value test and its restored-defect failure are in R3-2 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The spec no longer says `require_platform` ends the test: `unit-test-core.md:135` and `:229` say it returns whether the test goes on and the test returns right after `false`. The code gives that value (R2-1 fixed), the target's callers use it instead of their own guard (`test_page_input.gd:44`, `:61`), and `sample_platform.gd:13` fails the test if the body after `false` runs (checked by the second restoration in R3-2) |

## must fix

none

## unknown

- Only `client/godot/core/unit_test_core/tests/test_run.gd` was run, in the native headless pass, on the two restored copies; the unrestored code was run once with the same file in the `open-game-works-core-impl/` main checkout (pass). The browser run (`--web`) was not run in this round; the core agent report says `ogw core test godot --web UnitTestCore GameUpdateCore` passed
- `_finish_test` now returning `fail_reasons` for a skipped test has no test that fails without it: `_record` reads `state.fail_reasons` directly, so the result file is `fail` either way and only the GUT fail count differs. No defining document sets the GUT count, so this was not written as a finding
- Callers of `require_platform` outside this target (SoundCore, AuthCore, NativeUiCore, DataCore, TimeCore, ResolutionCore, SafeAreaCore, CutsceneCore, LocalizationCore, QaCore) were read only for a return right after the call; each returns through its own platform check equal to the list it passed, so none goes on after the skip. Their tests were not run
- The rest of the commit range (MessageCore, SceneCore, ShortcutCore, server modules, review-debt records) is not part of this target and was not reviewed
