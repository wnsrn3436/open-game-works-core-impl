# SceneCore review round 10

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R9-1 | fixed | `_panel_locked` (`client/godot/core/scene_core/scene_core.gd:56`) is set right after `UICore.set_panel_lock(true)` in stage 1 (`scene_core.gd:238`) and cleared right after `UICore.set_panel_lock(false)` in stage 7 (`scene_core.gd:372`). `_end_state` calls `UICore.set_panel_lock(false)` when `_panel_locked` and `UICore.is_initialized()` (`scene_core.gd:777`) and resets the flag (`scene_core.gd:802`), which is what `scene-core.md:113` requires, and it does not touch a lock of other code once stage 7 has passed. Tests `test_panel_opens_after_release_while_waiting_on_stage_6`, `test_panel_opens_after_release_of_a_transition_stopped_by_an_unrecoverable_failure` and `test_release_after_a_transition_leaves_a_panel_lock_of_other_code` (`client/godot/core/scene_core/tests/test_panels.gd:56`, `:68`, `:78`) cover `scene-core.md:192`. In a temporary copy outside the checkout I removed the `_end_state` call (`scene_core.gd:777-778`): the first two tests failed (`[""] expected to equal ["prefab/scene_core_test_panel"]`); with the fix they pass |
| R9-2 | fixed | `_hide_if_top` has a `Window` branch (`scene_core.gd:695`) that hides a visible `Window` and remembers it, used both by the stage 4 walk and `_on_node_added`, and `_show_hidden` makes it visible again (`scene_core.gd:738`), matching the top visual node list of `godot.md:291`. `test_window_is_not_on_screen_from_stage_4_until_stage_7` (`client/godot/core/scene_core/tests/test_scene_holder.gd:57`) checks the `Window` of the scene resource, a `Window.new()` added in stage 6 and a `Window` hidden in the scene resource. With the `_hide_if_top` `Window` branch removed in the temporary copy that test failed; with the fix it passes |
| R9-3 | fixed | Stage 4 fails through `_fail` also when `instance.get_class() != "Node"` (`scene_core.gd:299`); the `is SceneBase` test runs first, so a `null` instance is not called. `test_scene_root_of_another_engine_class_with_the_scene_base_script_is_fatal` (`client/godot/core/scene_core/tests/test_failure.gd:26`) uses `node2d_root.tscn` (a `Node2D` root with the `SceneBase` script) and checks `false`, no current scene and `_assert_fatal_stop`. With the class check removed in the temporary copy the test failed (`started:scene/scene_core_test_node2d_root` instead of `fatal`); with the fix it passes. The scenes of `benchmark/godot/resource/scene/bench/` and the core test scenes extending `SceneBase` have `Node` roots |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The SceneCore suite (67 tests, all passing) and the restored-defect runs ran with GUT 9.7.1 on Godot 4.7.2 in a temporary copy of `client/godot` of this checkout (with `addons/` and `build/` copied from `open-game-works-core-impl/client/godot/`), with a pre-run hook that only calls `UnitTestCore.init()`, not through `ogw core test` and its test host. The judgement of `ogw core test` on engine output lines was not applied, and the dependents of SceneCore were not run by me (the core agent report says `ogw core test godot` with them passed)
- `Window` hiding was checked on the `visible` property of an embedded `Window` in a headless run; whether a native (non-embedded) `Window` created visible when the scene enters the tree in stage 4 is drawn on a real display before `_hide_tree` hides it was not checked
- The other files changed in the range (`NativeUiCore`, `QACore`, server `auth`, `guild`, `storage`) are outside this target and were not read
