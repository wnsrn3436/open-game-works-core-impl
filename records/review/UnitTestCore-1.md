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

- The commit range de482eec..a33c5bd9 changes no file of `client/godot/core/unit_test_core/` and no module UnitTestCore depends on (`UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `NetworkCore`, `InputCore`, `UICore`, `RealtimeCore`, `BootstrapCore`). The changes are in CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore, the core settings files and review records. Checked where they meet UnitTestCore: the two new keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` are in `client/godot/generated/core_settings_types.json`, which `set_test_settings` reads (`client/godot/core/unit_test_core/dev/unit_test_core.gd:49`), so `client/godot/core/qa_core/tests/support/qa_test_case.gd` can set them; the PoolCore, SoundCore and TweenCore `init` that `client/godot/core/unit_test_core/tests/test_input.gd:17` calls read no new settings key; the new skip and DEV mute flags are cleared in each module's reset, which test setup reaches through `BootstrapCore.shutdown`. UnitTestCore code that the range does not reach was not reviewed again, because the commit range is not `none`
- UnitTestCore core tests were not run: no target code or test changed in the range, and the lead agent or `ogw review run` runs the suites
