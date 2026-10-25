# review: UICore round 1

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

- The commit range `772306a..2219823` changes no UICore file. It changes `LocalizationCore` (Godot: `client/godot/core/localization_core/localization_core.gd`, its tests and test resources), the core settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`), `core-spec/LocalizationCore.json`, and records. The review covered the places where UICore reaches the changed code:
  - `LocalizationCore.init` now fails without the two new integer settings. `client/godot/core/ui_core/tests/support/ui_test_case.gd:160` calls `LocalizationCore.init()` with the generated core settings, which hold both keys (`client/godot/generated/core_settings.json:474-475`). UICore sets no settings override that drops them.
  - UICore calls only `LocalizationCore.get_text` and `LocalizationCore.format` (`client/godot/core/ui_core/ui_core.gd:1785-1790`). Neither changed in the range.
  - UICore sets no font, theme font item or `theme_type_variation` on its own elements (`system_popup_view.gd` sets only the `separation` theme constant). The UICore spec gives no UICore element the `heading` text style, so its system popup and license screen elements draw in the `body` text style (the default font), which is what `LocalizationCore` `## behavior` defines for an element whose text style was not set.
- The UICore core tests were not run in this review. The report `records/1792899335100-update-core-mvn9z0scb9678f.md` states that `ogw core test godot` over the 26 dependents of `LocalizationCore` passed 1880 of 1880 tests in the native and browser runs, with the render pass of `AccessibilityCore`, `NativeUiCore` and `QACore` skipped; this review did not reproduce that run.
- The `LocalizationCore` changes themselves (weight chains, heading type variations, `release`) were not reviewed against the `LocalizationCore` spec beyond what UICore reaches; that is the scope of the `LocalizationCore` review.
