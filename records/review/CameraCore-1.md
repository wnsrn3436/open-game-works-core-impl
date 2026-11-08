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

- The commit range changes CameraCore only in d38bb046: `client/godot/core/camera_core/camera_core.gd:34` and `:136` (the shake noise is seeded at `init` with `TimeCore.make_random_seed("camera_shake")` instead of device time XOR monotonic time) and two new tests in `client/godot/core/camera_core/tests/test_shake.gd:150-183`. I checked these against `### random seed` of time-core.md, `### random` of util-core.md and the shake noise rule of camera-core.md (line 117), and found them to match. `init` checks `TimeCore.is_initialized()` before the call, and the purpose name is snake_case, so the failure value 0 of `make_random_seed` cannot happen. Both tests read the result of the seeding: the expected noise values from `make_purpose_seed("camera_shake", 42)` and then `43` after re-init, and the same offsets as `set_shake_seed(make_purpose_seed("camera_shake", 7))`. Both would fail under the earlier device-time seed.
- `ogw core test godot CameraCore` passed (job mw7tnw9nd1833f). Restoring the defect in a temporary worktree was not done, as this is round 1 and no `test evidence` finding is being judged.
- CameraCore code outside the changed places and their callers and callees (follow, move, zoom, bounds, convert, attach) was not reviewed, because the commit range does not touch it.
- The TimeCore, LogCore and other module changes in the range belong to other review targets. Only `make_random_seed` and `TimeCoreDev.set_random_base`, which the change uses, were read.
