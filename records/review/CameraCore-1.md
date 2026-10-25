# CameraCore review round 1

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

- The commit range d4e2728..051697b changes no file under `client/godot/core/camera_core/` and no `core-spec/CameraCore.json`, and it adds or changes no `CameraCore.*` setting or `TweenCore.maxDurationMs`. Of the dependencies (`LogCore`, `UtilCore`, `EventCore`, `TimeCore`, `ResourceCore`, `ResolutionCore`, `TweenCore`), only TweenCore changes: `client/godot/core/tween_core/tween_core.gd` adds `get_finite_playing_count`, and the TweenCore tests add cases (including a definition whose easing is not a member). CameraCore calls only `TweenCore.evaluate_easing` (`client/godot/core/camera_core/camera_core.gd:758`), `TweenCore.get_preset_kind` (`client/godot/core/camera_core/camera_core.gd:704`), `TweenCore.is_initialized` (`client/godot/core/camera_core/camera_core.gd:117`), the `Easing`/`TimeBasis` enums and the `TweenCore.maxDurationMs` setting. None of these changed in the range. CameraCore never calls `TweenCore.play`, so the new count does not reach CameraCore state. The CameraCore tests do not use `tween_test_case.gd` (`client/godot/core/camera_core/tests/support/camera_test_case.gd:1` extends `UnitTestCase`). The other changes in the range (AuthCore, ScreenEffectCore, UICore, UnitTestCore, QACore spec, server modules, records) are not CameraCore or its dependencies
- `records/review-debt/spec-CameraCore.json` items D1 and D2 (a non-member `Easing` of `move_to`, `zoom_to` and of a `move_by_preset` preset has no row in the CameraCore error table) are spec-side debt and not in this input. The code rejects a non-member easing with `Failed` and an error log in `_check_timing` (`client/godot/core/camera_core/camera_core.gd:643`), including after a preset loads (`client/godot/core/camera_core/camera_core.gd:712`). That is one of the two results that debt leaves open, so whether it matches the spec depends on how that spec debt is settled
- I read all of `client/godot/core/camera_core/camera_core.gd` and the list of test functions in `client/godot/core/camera_core/tests/` against the camera-core spec. I found no critical, high or medium problem to write as out of scope. I did not read every test body line by line, and I did not restore defects to check that the tests fail
- I did not run the Godot core tests. This review did no engine run
