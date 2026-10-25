# AdCore review round 1

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

- The commit range 772306afd2a3678f69ab999ae6f134c0fd11c0cc..ea339cfa3518485f778cc9ca1752f66629eb3433 changes no AdCore file (`client/godot/core/ad_core/`, `core-spec/AdCore.json`) and no file of a module in `## dependency` of the AdCore spec. It changes only LocalizationCore (`client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`), the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`) and agent records
- The only AdCore code that reaches the changed code is the test support `client/godot/core/ad_core/tests/support/ad_test_env.gd:59-77`, which calls `LocalizationCore.init`, `resolve_language` and `load_translation`. The new `init` requirement of the two integer settings (`client/godot/core/localization_core/localization_core.gd` `_read_settings`) is met by the defaults added to `client/godot/generated/core_settings.json:474-475`, and AdCore tests do not call `load_fonts`, the only operation whose behavior the range changed. The AdCore tests were not run in this review; that they still pass after the range is judged from the code only
- `client/godot/core/ad_core/ad_core.gd` was read whole against the AdCore spec for problems outside the range; no `critical`, `high` or `medium` problem with confidence 80 or more was found. The adapters (`adapters/admob_adapter.gd`, `adapters/ads_adapter.gd`), `dev/` and the tests were not read line by line for problems outside the range, because the range does not reach them
