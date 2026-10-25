# PaymentCore review round 1

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

- The commit range 772306a..7fa9648 changes no file under `client/godot/core/payment_core/`. It changes LocalizationCore only (`client/godot/core/localization_core/localization_core.gd`, its tests) and the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`, `core-spec/LocalizationCore.json`). LocalizationCore is not in `## dependency` of the PaymentCore spec
- Reach checked: `LocalizationCore.init` now needs the two new integer settings. `client/godot/core/payment_core/tests/support/payment_test_case.gd:92` calls `LocalizationCore.init`. CoreSettings reads `res://generated/core_settings.json` (`client/godot/core/core_settings.gd:8`), which has both keys, so the PaymentCore test boot still gets them. `LocalizationCore.load_fonts`, the one function whose behavior changed, is called only by `client/godot/core/bootstrap_core/bootstrap_core.gd:397` and never by PaymentCore or its tests. The guest warning popup (`client/godot/core/payment_core/payment_core.gd:486`) goes through `UICore.open_system_popup`. The font weight change affects only how its text looks, not its buttons, callbacks or result
- I skimmed `client/godot/core/payment_core/payment_core.gd` and `client/godot/core/payment_core/adapters/plugin_store_adapter.gd` for older problems at `critical`, `high` or `medium` severity and found none at confidence 80 or above. That was not a full review of the whole target. The test files under `client/godot/core/payment_core/tests/`, `client/godot/core/payment_core/dev/` and `client/godot/core/payment_core/adapters/store_adapter.gd` were not reviewed line by line, because they are outside the range and the range does not reach them
- The core tests were not run. The native plugins `ogw-iap-apple` and `ogw-iap-google` are outside this checkout and were not checked
