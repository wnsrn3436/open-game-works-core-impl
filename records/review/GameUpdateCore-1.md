# review GameUpdateCore round 1

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

- The commit range 772306a..9f7cf54 changes no file under `client/godot/core/game_update_core/`. The only code it changes is `client/godot/core/localization_core/localization_core.gd` (body and heading font weight, heading theme types in `load_fonts`, `_apply_fonts`, `_clean_up`) with its tests, the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`, `core-spec/LocalizationCore.json`) and review records of other modules. GameUpdateCore code calls no `LocalizationCore` operation (game-update-core.md:25 uses it only for the `DownloadedTranslation` type). Its test support `client/godot/core/game_update_core/tests/support/game_update_test_case.gd:267` calls `LocalizationCore.init`, `resolve_language`, `load_translation`, `get_text` and `release` but not `load_fonts`, and the two new integer settings that `init` now requires have defaults in `client/godot/generated/core_settings.json:474`. So no GameUpdateCore code or test is reached by the changed definitions, and nothing in the GameUpdateCore code outside the range was reviewed, because the range does not touch it
- The GameUpdateCore tests were not run against the changed LocalizationCore; that it still passes `init` rests on reading the code, not on a run
- The LocalizationCore change itself is outside the target and was read only as far as it reaches GameUpdateCore
