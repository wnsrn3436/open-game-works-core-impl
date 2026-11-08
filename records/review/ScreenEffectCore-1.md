# review ScreenEffectCore round 1

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

- The range 85f6b36d..21887ca0 changes ScreenEffectCore only in its tests: `client/godot/core/screen_effect_core/tests/test_handle.gd` adds `test_failed_handle_controls_no_overlay_while_a_fade_plays`, and `client/godot/core/screen_effect_core/tests/test_world_skip.gd` adds `clear_handle` of the skipped handle and a result count check. Both were checked against `## behavior` (effect handle, line 67 and line 80) and the `## test` items at lines 135 and 147 of the spec. The new test passes a destroyed owner and an opacity of 1.5, checks one error log per request and `Failed` for both, calls `skip_to_end` and `clear_handle` on both, checks the overlay color and opacity of that frame and that the fade still plays, and checks that the fade then ends `Completed` at opacity 1. In `screen_effect_core.gd`, `_failed_handle` keeps `_channel` at -1, so `_holds_overlay` is `false` and `skip_to_end` and `clear_handle` return before touching any overlay or handle; a skipped `World` handle is never put in `_current`, so the same holds for it
- The module code `screen_effect_core.gd`, `screen_effect_handle.gd`, `screen_effect_core_node.gd` and the DEV code are unchanged in the range. The dependency changes in the range were read where ScreenEffectCore reaches them: `log_core.gd` changes only comments; `time_core.gd` adds random seeds and the DEV frame step (`_frame_step_fps`), which only changes the real increment of an engine started with `--fixed-fps` or Movie Maker and is not set by the ScreenEffectCore tests. `TweenCore`, `EventCore`, `ResolutionCore` and `UICore` are unchanged in the range
- `ogw core test godot ScreenEffectCore` reported `pass` in this worktree (it also reported no test record because of the uncommitted deletion of this review file). The tests of the modules that depend on ScreenEffectCore were not run
- I did not restore defects in a temporary copy, since round 1 has no `test evidence` finding to settle. Reading the new test: it would fail if `skip_to_end` of a `Failed` handle wrote that request's end value (blue, opacity 1) to the `World` overlay, or if `clear_handle` of a `Failed` handle cleared the overlay or cancelled the playing fade
- Code outside the range was read only where the changed tests call it
