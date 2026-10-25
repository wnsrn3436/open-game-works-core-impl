# review RemoteConfigCore round 1

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

- The commit range 772306a..0ebd81b changes only LocalizationCore (`client/godot/core/localization_core/localization_core.gd`, its tests, test support and test resources), the settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`, `core-spec/LocalizationCore.json`) and run and review records. No RemoteConfigCore file (`client/godot/core/remote_config_core/`) changed, and none of its defining documents changed (input `## spec changes` is `none`). LocalizationCore is not in `## dependency` of the RemoteConfigCore spec (`LogCore`, `EventCore`, `TimeCore`, `DataCore`, `NetworkCore`, `AuthCore`), and RemoteConfigCore code does not refer to LocalizationCore, font or heading types (grep of `client/godot/core/remote_config_core/` finds LocalizationCore only in the test support)
- RemoteConfigCore tests (`client/godot/core/remote_config_core/tests/support/remote_config_test_case.gd:60-70`) call `LocalizationCore.init`, `resolve_language` and `load_translation`. `init` now also requires the two new integer settings in `_read_settings`; the tests read them from `client/godot/generated/core_settings.json:474-475`, where both are 0. The tests never call `load_fonts` (only BootstrapCore does, `client/godot/core/bootstrap_core/bootstrap_core.gd:397`), so `_apply_fonts` never runs, `_heading_chain` stays null and `_clean_up` does not reach `_restore_heading_types`. So RemoteConfigCore tests reach no new LocalizationCore path. This comes from reading the code: the RemoteConfigCore tests were not run, because they run through `ogw core test` with its test host, which a review agent does not start
- The rest of RemoteConfigCore was not reviewed, because the range did not touch it. The new LocalizationCore code and its tests were not reviewed either; they belong to LocalizationCore's own review
