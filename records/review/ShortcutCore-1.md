# ShortcutCore review round 1

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

- The commit range 772306a..6070fc7 changes no file under `client/godot/core/shortcut_core/` or `tools/data-tool/src/checks/ShortcutCore.ts`. The code changes in the range are in `LocalizationCore` (body and heading font weight: `client/godot/core/localization_core/localization_core.gd`, its tests) and the two new settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`, `core-spec/LocalizationCore.json`). ShortcutCore uses `LocalizationCore` only for the `FormatArgs` type (`shortcut_core.gd:182`), which the range does not change
- The ShortcutCore test setup `client/godot/core/shortcut_core/tests/support/shortcut_case.gd:83` calls `LocalizationCore.init()`, which now also requires the two new integer settings (`localization_core.gd:366`). The setup does not set `_test_values` for them, so they come from `generated/core_settings.json`, and `ogw core test` writes that file from `settings/core-settings.json`, which has both keys (default 0). Checked by reading only. The setup does not call `LocalizationCore.load_fonts`, so the new heading type variations (`_apply_fonts`) are never applied in ShortcutCore tests
- The ShortcutCore core tests were not run: `client/godot/addons/` (GUT) is missing from this checkout. It is filled only at `ogw core test` time, and a review agent does not start that job
- `shortcut_core.gd`, `shortcut_wait.gd`, `events/shortcut_navigated_event.gd` and `tools/data-tool/src/checks/ShortcutCore.ts` were read in full against `## navigate order`, `## release`, `## error` and `## data` of the spec, and no out-of-scope problem of severity `medium` or higher was found. The test files under `client/godot/core/shortcut_core/tests/` other than `support/shortcut_case.gd` and `test_requirement.gd:13` were not checked against each item of spec `## test`, because the range does not change them or the code they test
