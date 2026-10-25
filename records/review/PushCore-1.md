# PushCore review round 1

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

- The commit range 772306a..7e95e30 changes no file under `client/godot/core/push_core/`. It changes LocalizationCore (body and heading font weight, heading text style), its tests, the core settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`, and records. PushCore calls only `LocalizationCore.get_text` (`client/godot/core/push_core/push_core.gd:267`, `:268`) and `LocalizationCore.get_language_code` (`client/godot/core/push_core/push_core.gd:364`), and the range does not change either one. The new code paths (`_apply_fonts`, `_weighted_chain`, `_takes_weight`, `_restore_heading_types`) run only from `LocalizationCore.load_fonts` and `_clean_up`. Neither PushCore nor its test support (`client/godot/core/push_core/tests/support/push_test_env.gd`) calls `load_fonts`
- `LocalizationCore.init` now fails when the two new integer settings are missing (`client/godot/core/localization_core/localization_core.gd:366`). The PushCore tests init LocalizationCore with the generated core settings, and the range adds both keys to `client/godot/generated/core_settings.json`. `ogw core test godot PushCore` ran on this checkout at 7e95e30 and passed
- The rest of PushCore was skimmed for out-of-scope problems (`push_core.gd` whole file, `AuthCore.get_consent` and `update_push_consent` failure values). It was not reviewed aspect by aspect, because the range does not reach it
- The FCM and APNs real adapters and their plugins were not run on a device. Only the core test run above, on the host, covers them
