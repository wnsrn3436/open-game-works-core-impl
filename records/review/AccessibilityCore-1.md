# review: AccessibilityCore round 1

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

- I did not run the core tests in this review. No finding needed one to check it. The report `records/1794136624088-update-core-mw7qmf2w9b907c.md` says `ogw core test godot AccessibilityCore BootstrapCore QACore UnitTestCore` passed with and without `--web`. Commits 98913ab0 and aaa0e06d (test-only changes to `client/godot/core/accessibility_core/tests/test_reset_settings.gd`) came after that report. I did not confirm a test run on 9808fd47
- I did not check `LocalizationCore`, `CameraCore`, `ScreenEffectCore` and `SoundCore` beyond the operations that `reset_settings` and `list_text_scales` call (`set_text_scale`, `set_shake_scale`, `set_flash_opacity_limit`, `LocalDataCore.remove_value`). Their changes in the range belong to their own reviews
- `list_text_scales` writes int64 values of `AccessibilityCore.textScales` into a `PackedInt32Array`, as `client-core/engines/godot.md:487` requires. The schema sets no upper bound on an element, so a value above 2147483647 would be truncated. I did not write this as a finding: no permille text scale in that range is a plausible setting, and nothing relies on it
- I checked the commit range only for `client/godot/core/accessibility_core/`, `core-spec/AccessibilityCore.json` and the `AccessibilityCore.textScales` schema entry of `settings/core-settings.schema.json`. The rest of the range changes other modules
