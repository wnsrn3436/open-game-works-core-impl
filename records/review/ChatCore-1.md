# ChatCore review round 1

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

- The commit range 772306afd2a3678f69ab999ae6f134c0fd11c0cc..ea339cfa3518485f778cc9ca1752f66629eb3433 changes no ChatCore code, test or spec. It changes only LocalizationCore (`client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`), the core settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`) and the records of agent run mvn9z0scb9678f. LocalizationCore is not in `## dependency` of the ChatCore spec, and ChatCore source does not refer to it
- The only place in ChatCore that reaches the changed code is the test setup `client/godot/core/chat_core/tests/support/chat_test_case.gd:95`, `:109`, `:110` (`LocalizationCore.init`, `resolve_language`, `load_translation`). The change to that path is that `LocalizationCore.init` (`client/godot/core/localization_core/localization_core.gd:366`) now also requires the two new integer settings; both have the default 0 in `settings/core-settings.json:474` and `client/godot/generated/core_settings.json:474`, so the setup still passes them. The ChatCore tests do not call `LocalizationCore.load_fonts`, so the new `_apply_fonts` and `_restore_heading_types` paths are not reached by them. Read only, not checked by running the ChatCore tests
- ChatCore code and tests outside that test setup were not reviewed: they are not changed in the range and are not reached by the changes, so their pre-existing problems are outside this review
