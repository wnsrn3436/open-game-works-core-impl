# RealtimeCore review round 1

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

- The commit range 772306afd2a3678f69ab999ae6f134c0fd11c0cc..e89228dc40244fa379a982a56ff038838bd474f3 changes no RealtimeCore code, test or spec. It changes only LocalizationCore (`client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`), the core settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`) and agent run records (`records/`). LocalizationCore is not in `## dependency` of the RealtimeCore spec, and RealtimeCore source outside `tests/` does not refer to it
- The only place in RealtimeCore that reaches the changed code is the test setup `client/godot/core/realtime_core/tests/support/realtime_test_case.gd:125`, `:134`, `:135` (`LocalizationCore.init`, `resolve_language`, `load_translation`) and the teardown `:60` (`LocalizationCore.release`). The change to that path is that `LocalizationCore.init` (`client/godot/core/localization_core/localization_core.gd:366`) now also requires the two new integer settings; both have the default 0 in `settings/core-settings.json:474` and `client/godot/generated/core_settings.json:474`, and `set_settings` (`realtime_test_case.gd:95`) does not override them, so the setup still passes. The RealtimeCore tests do not call `LocalizationCore.load_fonts` or `BootstrapCore`, so the new `_apply_fonts` path is not reached, and `_clean_up` calls `_restore_heading_types` only when `_heading_chain` is set, which it is not. Read only, not checked by running the RealtimeCore tests
- RealtimeCore code and tests outside that test setup were not reviewed: they are not changed in the range and are not reached by the changes, so their pre-existing problems are outside this review
