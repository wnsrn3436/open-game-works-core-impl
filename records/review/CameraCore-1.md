# review CameraCore round 1

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

- The commit range changes CameraCore only by removing `CameraCoreDev.set_shake_skip`, the `_shake_skip` state, its check in `shake`, its reset in `_clean_up`, its assert in `tests/test_lifecycle.gd` and the test `test_shake_skip_adds_no_trauma_and_no_event_while_the_trauma_there_decays` in `tests/test_shake.gd`. The DEV table of the spec now has only `set_shake_seed`, which matches `client/godot/core/camera_core/dev/camera_core_dev.gd`. A grep of the checkout finds no remaining reference to `shake_skip` outside `records/`, and the callers of CameraCore in other modules (`accessibility_core`, `cutscene_core`, `bootstrap_core` tests) do not use it. The other changes of the range (QACore, SoundCore, ScreenEffectCore, PoolCore, TweenCore, NetworkCore, settings files) are outside this target and were read only for references to CameraCore
- The CameraCore core tests were not run in this review: no finding needed a reproduction, and `ogw review run` runs the core tests of the target and of the modules that depend on it
