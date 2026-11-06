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

- The commit range de482eec..e27753e1 changes no file under `client/godot/core/virtual_pad_core/`, nor any file of the modules in `## dependency` of the VirtualPadCore spec (LogCore, EventCore, LocalDataCore, ResourceCore, SafeAreaCore, InputCore, UICore). `git diff --name-only` of the range outside `records/` lists only CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore and TweenCore files, plus the settings files and generated settings that add `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`
- Checked the paths between that changed code and VirtualPadCore. VirtualPadCore code (`client/godot/core/virtual_pad_core/*.gd`, `dev/*.gd`) does not reference any changed module. UICore, which VirtualPadCore depends on, calls `TweenCore.play_preset` and `TweenCore.stop` (`client/godot/core/ui_core/ui_core.gd:553`, `:591`). The TweenCore change only adds `_finite_skip` (default `false`, set only by `TweenCoreDev.set_finite_skip`), so UICore panel tweens behave the same unless DEV code turns it on. The PoolCore effect skip, the SoundCore DEV mute and play skip, the CameraCore shake skip and the ScreenEffectCore World skip are also DEV switches that default off and are reset in each module's reset. The VirtualPadCore test support (`client/godot/core/virtual_pad_core/tests/support/virtual_pad_test_case.gd:133`, `:139`, `:140`, `:161`, `:163`, `:169`) only calls `init`/`release` of PoolCore, SoundCore and TweenCore, and none of their signatures changed
- No spec of VirtualPadCore, InputCore or UICore names the new QACore feedback switches or the DEV skips, and QACore code (`client/godot/core/qa_core/dev/`) does not reference VirtualPadCore
- With no changed code reached, the VirtualPadCore code and tests were not reviewed as a whole: this round covers only the commit range, as `## procedure` step 2 says
- The VirtualPadCore core tests were not run in this review: there is no finding to check, and `ogw core test` needs `--background` and the test project setup that the harness writes
