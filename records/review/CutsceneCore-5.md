# CutsceneCore review round 5

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

- The commit range does not change `client/godot/core/cutscene_core/`. The review covered the changes in the range to the dependency code that CutsceneCore calls: `CameraCore` (`snap_to`, `move_by_preset`, `stop_move`; the range changes only attach zoom and 3D field of view in `client/godot/core/camera_core/camera_core.gd`), `ScreenEffectCore` (`play_preset`, `wait_result`, `skip_to_end`, `clear_owner`, which now take the owner as a `Variant`; CutsceneCore passes the live `_view_root` at `client/godot/core/cutscene_core/cutscene_core.gd:1180` and `:1952`), `UICore.open_system_popup` (it can now wait for tween preset loading before it shows; CutsceneCore already awaits it and checks session, pause serial and pause state after it, `cutscene_core.gd:1742`-`:1747`, and back input during that load is consumed by `UICore._handle_back` before the back override, so no second pause starts), `LocalizationCore` (CutsceneCore calls only `get_text` and `format`, not `bind_text` or `unbind_text`) and `InputCore` (only a comment changed)
- Spec changes: the `cutscene-core.md` diff only removes the buffer sizing text from the `InputCore.maxKeysPerAction` and `InputCore.maxPadButtonsPerAction` rows. The buffer in `cutscene_core.gd:186`-`:188` and `_is_advance_binding` (`:1637`) is now an internal data structure that the spec leaves to the implementation; the keys are still read and checked in `init`, as the `## settings` rows still list them. The `camera-core.md` removal of the `Easing` and duration failures of `move_by_preset` does not change CutsceneCore: its own `Camera` start check still checks the first change duration against `TweenCore.maxDurationMs`, and no CutsceneCore test relies on a `move_by_preset` `Failed` for those inputs. The `ui-core.md` changes (`open_popup` failure values, `PanelFlowFinishedEvent` order) concern operations and events CutsceneCore does not use
- Tests run: `ogw core test godot CutsceneCore` on the checkout under review (pass). `--web` runs and the native render pass of `QACore` were not run
- The case of a system popup prefab with open or close tween presets during the cutscene pause (the new loading wait of `open_system_popup`) has no CutsceneCore test; by reading the code, a stop or `release` during that wait makes the `await` return to a pause serial or session check that ends without effect
