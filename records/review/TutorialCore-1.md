# TutorialCore review round 1

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

- The commit range changes no file of `client/godot/core/tutorial_core/`. The changes that reach TutorialCore are the LocalizationCore font weight and heading text style (`client/godot/core/localization_core/localization_core.gd`) and the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `client/godot/generated/core_settings.json`). Checked: TutorialCore calls only `LocalizationCore.is_initialized`, `bind_text` and `unbind_text` (`client/godot/core/tutorial_core/tutorial_core.gd:262`, `:973`, `:1113`, `:1145`), which the range does not change; it sets no font, theme or `theme_type_variation`, and `skills/client-core/modules/tutorial-core.md` sets no text style for the tutorial view. The test setup `client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:147` calls `LocalizationCore.init`, whose `_read_settings` now also requires the two new integer keys; the test settings start from `res://generated/core_settings.json` (`client/godot/core/core_settings.gd:8`), which holds both, so init is not broken. `load_fonts` is not called by TutorialCore or its tests
- The core tests were not run in this review; the conclusion that the TutorialCore tests still pass after the range is from reading the code above
- The rest of TutorialCore code and tests, which the range does not change and which the changes do not reach, was not reviewed
