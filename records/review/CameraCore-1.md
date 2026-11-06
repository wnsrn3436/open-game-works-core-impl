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

- The CameraCore change in the range de482eec..9069447b is the DEV operation `set_shake_skip` (`client/godot/core/camera_core/camera_core.gd:92`, `client/godot/core/camera_core/camera_core.gd:402`, `client/godot/core/camera_core/camera_core.gd:515`, `client/godot/core/camera_core/dev/camera_core_dev.gd:18`) and its tests (`client/godot/core/camera_core/tests/test_shake.gd:175`, `client/godot/core/camera_core/tests/test_lifecycle.gd:163`). Checked against `## DEV` and `## test` of the camera-core spec: the skip comes after the camera check and the amount check of `## error`, so `shake`(0) and `shake` with no camera still log; while it is on, no trauma, no log and no `CameraShakeStartedEvent`; existing trauma and the shake scale are unchanged; attach and detach keep it; `release` (`_clean_up`) turns it off; it is off at `init`. The test checks each of these, and restoring any one of these defects in the code (no reset in `_clean_up`, skip before the amount check, trauma added while skipped) would fail an assert of `test_shake_skip_adds_no_trauma_and_no_event_while_the_trauma_there_decays` or `_assert_initial_state` (checked by reading, not run)
- Core tests were not run in this review: the GUT addon is not in the checkout, and `ogw agent merge` requires a passing `ogw core test` before the merge
- The caller in `client/godot/core/qa_core/dev/qa_core.gd:1268` belongs to the QACore target and was not reviewed beyond confirming it calls `CameraCoreDev.set_shake_skip` with a bool
- Code of CameraCore outside the changed places, and outside the callers and callees of the changed code, was not reviewed, since the commit range is not `none`
