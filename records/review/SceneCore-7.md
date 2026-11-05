# SceneCore review round 7

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R6-1 | fixed | `_restore_stopped` (`client/godot/core/scene_core/scene_core.gd:708`) sets the remembered mode on every remembered node that `instance_from_id` still finds, without reading `process_mode`, and `_stopped` (`scene_core.gd:67`) keeps one mode per instance id, written by `_stop_if_own_mode` (`scene_core.gd:664`) only when it reads a mode of the node's own at stage 4 or `node_added`. This is what the mapping says (`open-game-works-core/skills/client-core/engines/godot.md:291`). Test: in a temporary clone under `worktrees/_core/`, the round 6 behavior was restored in `_restore_stopped` (`if node != null and node.process_mode == Node.PROCESS_MODE_DISABLED:`). `ogw core test godot SceneCore --file client/godot/core/scene_core/tests/test_scene_holder.gd` then failed `test_remembered_node_gets_its_remembered_mode_back_at_stage_7` (`client/godot/core/scene_core/tests/test_scene_holder.gd:135`) with "[1] expected to equal [3]: remembered mode of the resource node; [3] expected to equal [1]: remembered mode after another mode; [0] expected to equal [3]: remembered mode after inherit". The unchanged code passes |
| R6-2 | fixed | `client/godot/core/scene_core/tests/resources/scene_b.tscn` now has `Hidden2D` (`Node2D`), `HiddenLayer` (`CanvasLayer`) and `Hidden3D` (`Node3D`) with `visible = false` directly under the scene root. `test_node_hidden_in_the_scene_resource_is_still_hidden_after_the_transition` (`client/godot/core/scene_core/tests/test_scene_holder.gd:57`) asserts that they are hidden after `started:` and that `Probe`, `Layer` and `Spatial` are visible. `test_node_that_on_prepare_hides_is_visible_after_stage_7` (`test_scene_holder.gd:79`) covers the other changed sentence of `scene-core.md:47`. Test: in a temporary clone, the `layer.visible`, `item.visible` and `spatial.visible` conditions of `_hide_if_top` (`client/godot/core/scene_core/scene_core.gd:677`, `:682`, `:687`) were removed. The test file then failed `test_node_hidden_in_the_scene_resource_is_still_hidden_after_the_transition` and `test_node_that_on_prepare_hides_is_visible_after_stage_7` |
| R2-2 | fixed | `stop_check_node.gd`, `_watched`, `_watching`, `_set_watching`, `_check_stopped` and the `node_removed` connection are removed (no match under `client/godot/`). The only per-frame code of SceneCore is `_process` of `client/godot/core/scene_core/scene_core_node.gd:6`, which calls `_check_frame` (`client/godot/core/scene_core/scene_core.gd:739`). `_check_frame` reads only the deadline wait and no node of the new scene. `visible` and `process_mode` are read only in `_hide_tree` (`scene_core.gd:634`, called right after the stage 4 `add_child()`) and in `_on_node_added` (`scene_core.gd:731`), as `godot.md:291` says |
| R1-1 | open | Still reproduced on the current code. Run path: in a temporary clone under `worktrees/_core/`, a scratch test in `client/godot/core/scene_core/tests/test_scene_holder.gd` did these steps. `preload_hook` of `scene_b` added a process counter with `PROCESS_MODE_INHERIT`. With the prepare gate closed, after `wait_trace("prepare:scene_b")`, the test set that counter's `process_mode` to `PROCESS_MODE_ALWAYS` and waited 3 frames. The counter had counted 3 `_process` calls while the scene root had counted 0 ("[3] expected to equal [0]: mode given after add"). This is against "does not receive the per-frame engine callbacks" (`open-game-works-core/skills/client-core/modules/scene-core.md:47`), the test item at `scene-core.md:171`, and "`_process()`, `_physics_process()` ... do not run" (`godot.md:291`). The report disputes the finding. Its evidence is that code which reads `process_mode` only at stage 4 and `node_added` (`godot.md:291`) cannot stop this case, because Godot sends no other object a signal when a node's mode changes. That evidence is right, but it shows that the defining documents conflict, not that the node does not run. So the finding is not withdrawn, and it is solved only by a change to the defining documents (the report's `## spec proposals`, a decision for the lead or the human). Since R2-2 removed the per-frame check, the case covers every mode that scene code gives a node after it was added, not only one given after the check ran in a frame |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The item's run path is a `PROCESS_MODE_ALWAYS` node that scene code adds before stage 7. `_on_node_added` (`client/godot/core/scene_core/scene_core.gd:731`) disables that node through `_stop_if_own_mode` (`scene_core.gd:664`), and `test_nodes_with_a_process_mode_of_their_own_run_frames_only_after_stage_7` (`client/godot/core/scene_core/tests/test_scene_holder.gd:101`) covers it and passes. The item's problem, a node with a mode of its own that receives `_process` from stage 4, remains for a mode given after the node was added. That is R1-1 in `## previous`, reproduced on the current code with 3 `_process` calls before stage 7 |

## must fix

none

## unknown

- Only the native headless pass of `client/godot/core/scene_core/tests/test_scene_holder.gd` was run: on this checkout (passed), and in temporary clones under `worktrees/_core/` for the R6-1 and R6-2 mutations and the R1-1 run path. The clones were deleted after the runs. The other SceneCore test files, the `--web` run and the modules that depend on SceneCore were not run by this review
- The changes in the range to modules other than SceneCore (CutsceneCore, ShortcutCore, UnitTestCore, GameUpdateCore tests, server modules) were not read: they are outside the target, and SceneCore calls none of the changed code
- Carried over from round 6 and not run in the engine: whether `visible = false` on a `CanvasItem` hides a descendant `CanvasItem` whose `top_level` is `true`, and how a `Window` or `SubViewport` under the scene holder behaves
- Not run: a remembered node that scene code moves out of the scene holder before stage 7 stays `PROCESS_MODE_DISABLED` until stage 7 and then gets its remembered mode (no `node_removed` handling any more). Read from the code (`scene_core.gd:708`). It matches the "remembered nodes that are `is_instance_valid()`" wording of `godot.md:291`
