# review NativeUiCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/native_ui_core/native_ui_core.gd:93 | Commit ad967246 adds the behavior of `release` of a NativeUiCore that is not `init`ed: it deletes the adapter that `set_native_adapter` set before `init` (rule of `## lifecycle` of skills/core/SKILL.md: a `release` of a module that is not `init`ed deletes the values its operations called before `init` set, calls no other module and leaves no log). No test checks it: every test of client/godot/core/native_ui_core/tests calls `release` only after `init` (test_lifecycle.gd:11, :22, :46, :76, support/native_ui_test_case.gd:57), and every test that reads `_adapter` or `can_share` sets the adapter itself first through `start_modules` (support/native_ui_test_case.gd:47) or `reboot`, so a value left by the previous test is always overwritten. client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd checks only `DataCore` and `ResourceCore`, and no bootstrap test reads `NativeUiCore._adapter`. Run path: with line 93 deleted, `set_native_adapter(fake)` then `release()` without `init`, then `init()` gives `can_share() == true` and the fake adapter, against the rule, and no test fails | Add a test to test_lifecycle.gd: after `start_modules(FakeNativeUiAdapter.new(), false)`, call `NativeUiCore.release()` without `init`, then `init()`; check `_adapter` is null, `request_review()` is `Unsupported`, `can_share()` is `false`, and there is no error and no warn log | no | 88 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the core tests (`ogw core test`). The finding comes from reading the code and tests: grep of client/godot for `NativeUiCore` and `set_native_adapter` found no test outside client/godot/core/native_ui_core/tests that sets or reads the NativeUiCore adapter
- Of the commit range, only client/godot/core/native_ui_core/native_ui_core.gd changed in NativeUiCore (2 lines in `release`). The code it calls and the code that calls it (`_clean_up`, `set_native_adapter`, `init`, `NativeUiCoreDev`, `BootstrapCore._shutdown` / `_release_entry`, `BootstrapCore` native adapter setup) were read. `_fake_review_result` and `_fake_share_result` are set only after `init` (`NativeUiCoreDev._check_initialized`), so the adapter is the only value an operation called before `init` sets, and the not-init `release` deletes it without calling another module or logging
- The platform adapters (adapters/native_ui_plugin_adapter.gd, adapters/native_ui_web_adapter.gd), the core node, the capture and share paths, and the rest of the tests did not change in the range and were not reviewed again
