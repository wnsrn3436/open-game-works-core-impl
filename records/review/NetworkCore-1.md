# NetworkCore review round 1

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

- The commit range de482eec..d01735db changes no file under `client/godot/core/network_core/` and no NetworkCore spec (`## spec changes` is `none`). The range changes CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore, TweenCore, the QACore core settings keys and the review records. The parts of these changes that touch NetworkCore were checked: `client/godot/core/qa_core/dev/qa_builtins.gd` still calls the unchanged `NetworkCoreDev.force_delay`, and the new built-ins `set_feedback_off` and `set_reward_presentation_off` do not call NetworkCore. `client/godot/core/network_core/tests/support/network_test_case.gd` starts PoolCore, SoundCore and TweenCore, whose new DEV skip state (`_effect_skip`, `_play_skip`, `_dev_mutes`, `_finite_skip`) is off by default and reset in their reset functions. `ogw core test godot NetworkCore` on this checkout gave `pass`
- The NetworkCore code and tests that the range does not reach were not reviewed again in this round, because the range does not change them
