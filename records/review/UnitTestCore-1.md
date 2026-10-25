# UnitTestCore review round 1

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

- The commit range 772306a..ce9e27a changes no file under `client/godot/core/unit_test_core/`. It changes LocalizationCore (font weight), its tests, the settings files (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`) and `core-spec/LocalizationCore.json`, plus review records. So I checked only the UnitTestCore code that these changes call: `set_test_settings`, `set_invalid_test_settings`, `_can_set_test_settings`, `_read_settings_types`, `_has_settings_type`, `_is_whole`, `_json_kind` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1516-1650`), `check_logs` with level `warn` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1260`), `require_platform`, and `CoreSettings._set_test_value` (`client/godot/core/core_settings.gd:225`)
- With the new keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` typed `integer` in `client/godot/generated/core_settings_types.json`, `set_test_settings(key, 400)` passes the type check, and `set_invalid_test_settings(key, "400")` stores a string value without the check, as `## settings` of the spec and the new LocalizationCore tests expect. I found no problem in these paths
- The rest of UnitTestCore (test setup, fake network, test clock, test host, WebSocket relay, page input, run and result file, time limits) was not reviewed, because no change in the range touches it or calls it
- Tests were not run. I judged by reading the code only
- I did not check whether the LocalizationCore changes match the LocalizationCore spec, because that module is outside this target
