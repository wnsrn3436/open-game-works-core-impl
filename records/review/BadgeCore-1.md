# BadgeCore review round 1

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

- The commit range `d4e2728..c6a1194` changes no BadgeCore code or test. `git diff --name-only` shows no file under `client/godot/core/badge_core/`, and no file of the BadgeCore dependency modules (LogCore, EventCore, TimeCore, ResourceCore, LocalDataCore, LocalizationCore, DataCore, UserStateCore, RequirementCore). The client changes are in `client/godot/core/auth_core/tests/`, `client/godot/core/screen_effect_core/`, `client/godot/core/tween_core/`, `client/godot/core/ui_core/` and `client/godot/core/unit_test_core/`, plus `client/godot/generated/core_settings.json` and `core_settings_types.json`
- Checked where the changed files reach BadgeCore. BadgeCore reads core settings only through `CoreSettings.has_string`/`get_string`/`has_int`/`get_int` for its three `BadgeCore.*` keys (`client/godot/core/badge_core/badge_core.gd:797`). The `core_settings.json` diff adds `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` and renames `uiQuality.settleMs` to `settleLimitMs`. No client core script reads `uiQuality` (only `server/core/testing/dev/setting_types.ts` and the generated files have it), so no BadgeCore key and no init of the test setup changes
- The BadgeCore test setup calls `TweenCore.init()` and `UICore.init()` (`client/godot/core/badge_core/tests/support/badge_test_case.gd:63`). The range only adds `TweenCore.get_finite_playing_count` (`client/godot/core/tween_core/tween_core.gd:328`) and `UICore.is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:654`); neither init changes and BadgeCore calls neither. The BadgeCore tests call `UnitTestCore.wait_frames`, `check_script_errors`, `check_logs` and `set_test_settings`; the range changes only `_begin_run`, `_send_init_failure` and adds `_send_started` (`PUT /started` before the first test) in `client/godot/core/unit_test_core/dev/unit_test_core.gd`, which run before any BadgeCore test setup and do not change those helpers
- Code that existed before the range was read (`client/godot/core/badge_core/badge_core.gd`, `badge_core_node.gd`, `badge_view.gd`), but only as context; it is outside the changes of this range, and no critical, high or medium problem with reproducing evidence was found in it. The BadgeCore tests under `client/godot/core/badge_core/tests/` other than `tests/support/badge_test_case.gd` were not read
- The BadgeCore core tests were not run in this review. The run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares, so whether they pass on `c6a1194` is not checked here
