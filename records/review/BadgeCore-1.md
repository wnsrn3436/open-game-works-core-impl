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

- The commit range `d4c3ae7..a362280` changes no BadgeCore code or test and no file of `core-spec/BadgeCore.json`. `git diff --name-only` shows no file under `client/godot/core/badge_core/` and no file of the BadgeCore dependency modules (LogCore, EventCore, TimeCore, ResourceCore, LocalDataCore, LocalizationCore, DataCore, UserStateCore, RequirementCore). The client changes are `client/godot/core/ui_core/ui_core.gd`, the UICore tests and test resources, `client/godot/core/qa_core/dev/qa_query.gd`, the QACore tests and test resources, and `client/godot/generated/core_settings.json`
- Checked where the changed files reach BadgeCore. BadgeCore code does not refer to UICore or QACore, and `client/godot/core/ui_core/` and `client/godot/core/qa_core/` do not refer to `BadgeCore` or `BadgeView` (`grep` of each folder). The only reference from `client/godot/core/badge_core/` is `UICore.init()` in the test setup (`client/godot/core/badge_core/tests/support/badge_test_case.gd:63`). The `ui_core.gd` diff adds `is_dimmed`, `_is_dimmed` and `_dim_above` and does not change `init`, so that setup is not affected
- BadgeCore reads core settings only through `CoreSettings.has_string`/`get_string`/`has_int`/`get_int` for its `BadgeCore.*` keys (`client/godot/core/badge_core/badge_core.gd:806`). The `core_settings.json` diff removes only `uiQuality.maxFlatShare`, so no BadgeCore key changes (`client/godot/generated/core_settings.json:374` still has the three keys)
- Code that existed before the range was not reviewed again; it is outside the changes of this range
- The BadgeCore core tests were not run in this review. The run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares, so whether they pass on `a362280` is not checked here
