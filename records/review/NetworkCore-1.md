# NetworkCore review round 1

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

- The commit range 772306afd2a3678f69ab999ae6f134c0fd11c0cc..3f1a6fc6a871b70158e1100daebd715c6610476e changes no NetworkCore code, test or spec (`client/godot/core/network_core/`, `core-spec/NetworkCore.json`) and no file of a module in `## dependency` of the NetworkCore spec (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore`, `UICore`, `MessageCore`). It changes only LocalizationCore (`client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`), the core settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`) and agent records (`records/`)
- NetworkCore source does not refer to LocalizationCore. The only NetworkCore code that reaches the changed code is the test support `client/godot/core/network_core/tests/support/network_test_case.gd:74`, `:83`, `:84`, `:283` (`LocalizationCore.init`, `resolve_language`, `load_translation`, `get_text`). The change on that path is that `_read_settings` of `LocalizationCore.init` now also requires the two new integer settings; `CoreSettings` reads `res://generated/core_settings.json` (`client/godot/core/core_settings.gd:8`), which has both with the default 0 (`client/godot/generated/core_settings.json:474-475`), so the setup still passes them. NetworkCore tests do not call `LocalizationCore.load_fonts` (its only caller outside LocalizationCore is `client/godot/core/bootstrap_core/bootstrap_core.gd:397`), so the new `_apply_fonts`, `_weighted_chain` and `_restore_heading_types` paths are not reached by them, except `_clean_up`, which runs `_restore_heading_types` only when `_heading_chain` is set by `load_fonts`. Judged from the code only; the NetworkCore tests were not run in this review
- NetworkCore code and tests other than that test support were not reviewed line by line for problems outside the range, because they are not changed in the range and are not reached by the changes
