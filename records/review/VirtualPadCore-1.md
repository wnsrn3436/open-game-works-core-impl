# review VirtualPadCore round 1

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

- The commit range 772306a..ca7da9e changes only LocalizationCore (`client/godot/core/localization_core/localization_core.gd`, its tests and test resources, `core-spec/LocalizationCore.json`), the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`) and `records/`. No file of `client/godot/core/virtual_pad_core/` or `core-spec/VirtualPadCore.json` is in the range
- LocalizationCore is not in `## dependency` of the VirtualPadCore spec; it reaches VirtualPadCore only through UICore. VirtualPadCore code does not reference LocalizationCore, labels, theme fonts or the `HeadingLabel`/`HeadingButton`/`HeadingRichTextLabel` type variations (grep of `client/godot/core/virtual_pad_core/` for `Label`, `theme`, `font`, `Heading`, `LocalizationCore` matches only the test support). The changed `load_fonts`/`_apply_fonts` path is called only by `client/godot/core/bootstrap_core/bootstrap_core.gd:397`, not by VirtualPadCore code or tests
- `client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:130` calls `LocalizationCore.init()`, which now also requires the two integer settings (`localization_core.gd` `_read_settings`). They are in `client/godot/generated/core_settings.json`, which `client/godot/core/core_settings.gd:8` reads, so the VirtualPadCore test setup is checked by reading only; the VirtualPadCore tests were not run in this review
- The VirtualPadCore code and tests outside the range were not reviewed, because the range does not change them or the code they call, and input `## debt` and `## must fix` are `none`
- The LocalizationCore changes themselves were read only for their effect on VirtualPadCore; they were not reviewed against the LocalizationCore spec
