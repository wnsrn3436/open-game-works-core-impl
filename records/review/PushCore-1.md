# PushCore review round 1

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

- The commit range d4c3ae7..d5af89f changes no file under `client/godot/core/push_core/`, `core-spec/PushCore.json` is unchanged, and input `## spec changes` is `none`. Outside `records/`, the range changes only `UICore` (`client/godot/core/ui_core/ui_core.gd`: `is_dimmed`, `_is_dimmed`, `_dim_above`; `core-spec/UICore.json`; tests and test resources), `QACore` DEV code (`client/godot/core/qa_core/dev/qa_query.gd`: `dimmed` in `list_ui`; tests and test resources) and the generated core settings (`client/godot/generated/core_settings.json`: `maxFlatShare` removed)
- PushCore does not call the changed code. Product code under `client/godot/core/push_core/` does not refer to `UICore` or `QACore`. Only the test support uses `UICore`, through `UICore.init`, `UICore.prepare` and `UICore.release` (`client/godot/core/push_core/tests/support/push_test_env.gd:57`, `:78`, `:97`), none of which the range changes. `QACore` calls PushCore from `client/godot/core/qa_core/dev/qa_builtins.gd:865`, `:875`, and the range does not change that file. The only settings PushCore reads, `PushCore.deviceTokenTimeoutMs` and `PushCore.permissionReadTimeoutMs`, are unchanged (`client/godot/generated/core_settings.json:283`, `:469`)
- `ogw core test godot PushCore` ran on this checkout at d5af89f and passed (61 of 61, job mvzmihm95fb9b7). Whole-suite runs and the core tests of other modules were not run
- The rest of PushCore was read (`push_core.gd`, its adapters and DEV code) but not checked aspect by aspect, because the range does not reach it. Of its tests, only the start of `client/godot/core/push_core/tests/test_registration.gd` was read
- The UICore and QACore changes themselves were not reviewed, because they are outside this target
- The FCM and APNs real adapters and their plugins were not run on a device. Only the core test run above, on the host, covers them
- Server `push` has no change in the range and was not reviewed here
