# review TutorialCore round 1

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

- The range de482eec..bc0b3906 changes no file under `client/godot/core/tutorial_core/` and no TutorialCore spec. It changes CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore, settings keys `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs`, and records. None of these is in the dependency list of the TutorialCore spec, and no TutorialCore source file (outside tests) refers to them (`grep` for `TweenCore`, `SoundCore`, `PoolCore`, `ScreenEffectCore`, `CameraCore`, `QACore` in `client/godot/core/tutorial_core/*.gd` finds nothing).
- Checked that the new DEV state of those modules (`_finite_skip`, `_dev_mutes`, `_play_skip`, `_effect_skip` and the skip handles, `_world_skip`, `_shake_skip`) starts `false` and is reset in their release or clean up (`tween_core.gd` `_end_state`, `sound_core.gd` `_reset_state`, `pool_core.gd` `_reset`, `screen_effect_core.gd` `_reset_state`, `camera_core.gd` `_clean_up`), so the `init` and `release` calls of `client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:94` and `:146` meet the same default state as before the range.
- QACore `set_feedback_off` (`client/godot/core/qa_core/dev/qa_core.gd`) turns on `TweenCoreDev.set_finite_skip`; TutorialCore does not request tweens itself, so any effect on tween-based UI shown with the tutorial view belongs to UICore or TweenCore, not this target.
- The TutorialCore core tests were not run in this review: GUT is not installed in this checkout (`client/godot/` has no `addons/`), and no finding needed a test run. `ogw review run` runs the core tests of the dependent modules after fixes.
