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

- Scope: only the CameraCore changes of the range (80657fc: `_fov_one` in `client/godot/core/camera_core/camera_core.gd`, doc comments, and the new tests in `test_attach.gd`, `test_bounds.gd`, `test_follow.gd`, `test_move.gd`, `test_zoom.gd`, `test_lifecycle.gd`, `support/camera_test_case.gd`) and the code they call (`attach_camera`, `_clear_camera`, `_apply_now`, `_apply_zoom`, `_apply_transform`, `_fit_bounds`, `_view_extents`, `_ground_offset`, `_on_frame`, `_advance_shake`, `follow`, `move_to`, `move_by_preset`, `_load_preset`, `zoom_to`, `release`, `_clean_up`). The other modules changed in the range were read only for `unit_test_core.gd`, whose changes (start time limit setting, skip/fail ordering, `require_platform` return value) do not touch the test helpers CameraCore tests use (`advance_clock`, `wait_frames`, `check_logs`, `set_test_settings`)
- The core tests were not run in this review; the pass result is the one in `records/1793882329470-update-core-mw3j803i37fc9a.md`. No finding needed a run or a restored defect
- Not checked whether the `fov` check after a frame in `test_attach_camera_keeps_the_camera_zoom_as_factor_one_and_the_view_follows_the_factor` (`client/godot/core/camera_core/tests/test_zoom.gd:101`) fails on the code before 80657fc. `Camera3D.fov` is stored as `real_t`, so the tan/atan round trip of the old code may already have given back exactly 50.0. The behavior the spec sets (`attach_camera` does not change the field of view) holds on the current code either way
- A camera object outside the scene tree: `_clear_camera` (`client/godot/core/camera_core/camera_core.gd:556`) and `stop_shake` (`client/godot/core/camera_core/camera_core.gd:407`) do not put such a camera at the base position and base rotation without the shake, and `_on_frame` skips it. The spec and the Godot rules take the world position as `global_position`, which Godot does not give outside the tree, so whether the spec covers this case was not decided; unchanged by the range
- Platform-specific behavior (web export) of the new tests was not checked
