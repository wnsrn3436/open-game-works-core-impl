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

- The commit range 2ef5ae8..440dc23 changes, on the client side, only AuthCore, BootstrapCore, SoundCore and TweenCore (`client/godot/core/auth_core/`, `client/godot/core/bootstrap_core/`, `client/godot/core/sound_core/`, `client/godot/core/tween_core/`), the generated contract (`client/godot/generated/contract/core_contract.gd`), the generated settings (`client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`), `core-spec/` files of other modules, `benchmark/`, server code, settings and `records/`. No file of `client/godot/core/virtual_pad_core/` or `core-spec/VirtualPadCore.json` is in the range
- None of the changed modules is in `## dependency` of the VirtualPadCore spec. VirtualPadCore code does not reference them: grep of `client/godot/core/virtual_pad_core/*.gd` for `SoundCore`, `TweenCore`, `AuthCore`, `BootstrapCore`, `QACore`, `uiQuality` and `core_contract` has no match. Of UICore it calls only `UICore.get_layer` (`client/godot/core/virtual_pad_core/virtual_pad_core.gd:85`) and `UICore.get_open_popup_count` (`virtual_pad_core.gd:417`, `virtual_pad_core.gd:450`), and UICore is not changed in the range
- `client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:130` calls `SoundCore.init()` and `TweenCore.init()`. `SoundCore._read_settings` now also requires `SoundCore.sfxPitchVariationCents`, `SoundCore.sfxVolumeVariationDb`, `SoundCore.voiceDuckDb`, `SoundCore.voiceDuckAttackMs` and `SoundCore.voiceDuckReleaseMs`; all are in `client/godot/generated/core_settings.json` within their ranges, and the test support does not override settings. The TweenCore change (offset transform for a `Control` whose parent is a `Container`) does not change `TweenCore.init`. This was checked by reading only; the VirtualPadCore tests were not run in this review
- The VirtualPadCore code and tests outside the range were not reviewed, because the range does not change them or the code they call, input `## spec changes` is `none`, and input `## debt` and `## must fix` are `none`
- The changes of the other modules were read only for their effect on VirtualPadCore; they were not reviewed against their own specs
