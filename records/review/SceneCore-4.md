# SceneCore review round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_set_watching(true)` now runs before `_hide_tree(_holder)` (`client/godot/core/scene_core/scene_core.gd:335`, `:336`), so `_on_node_added` puts a node that a hiding handler adds into `_watched`. In a temporary clone of this checkout at `5101b3e`, `ogw core test godot SceneCore --file client/godot/core/scene_core/tests/test_scene_holder.gd` passed. With `scene_core.gd` of `1646bb4` put back in that clone (the old order: `_hide_tree(_holder)` then `_set_watching(true)`), the same run failed in `test_node_added_by_a_handler_of_the_stage_4_hiding_runs_frames_only_after_stage_7` (`tests/test_scene_holder.gd:139`): "the added node is in the set", and 9 `_process` and 3 `_physics_process` calls before stage 7 |
| R2-1 | open | Not changed in the range. `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:685`) still writes `PROCESS_MODE_DISABLED` on nodes under the holder, against "SceneCore writes no property of a node under the holder" (`open-game-works-core/skills/client-core/engines/godot.md:291`), and `_restore_stopped` (`:727`) still replaces a `PROCESS_MODE_DISABLED` that scene code writes. `## spec changes` is `none`, so the mapping that the core agent report proposes is not settled yet |
| R2-2 | open | Not changed in the range. `_check_stopped` (`client/godot/core/scene_core/scene_core.gd:768`) still reads `process_mode` of every node in `_watched` (`:773`) from both `_process` and `_physics_process` of `stop_check_node.gd` on every frame from stage 4 until stage 7, so the work per frame grows with the node count of the new scene. The report disputes only the `spec change: no` label and states that the finding is real, so it is not withdrawn. Closing it without the per-frame check needs the spec decision of R2-1 |
| R1-1 | open | Not changed in the range: a mode that scene code gives a node after the stop check ran in a frame (round 3 run path: a counter with `process_priority = 100` set to `PROCESS_MODE_ALWAYS` from a signal emitted in the `_process` of another node) still gets one `_process` call before stage 7, against `open-game-works-core/skills/client-core/modules/scene-core.md:47`. The report disputes only the `spec change: no` label: Godot sends no signal that SceneCore can receive when another node's `process_mode` changes, so a polling check cannot close the gap between two checks. That is right, but the node still runs, so the finding is not withdrawn. It is closed by the spec decision of R2-1 |
| R1-2 | open | Not changed in the range: `_hide_if_top` still writes `visible = false` (`client/godot/core/scene_core/scene_core.gd:701`) and `_show_hidden` writes `visible = true` (`:744`) on every remembered node. In a temporary clone at `5101b3e`, a scratch test whose `prepare_hook` of `scene_b` set `probe.visible = false` failed after `started:scene_b` with "probe hidden by on_prepare stays hidden". No spec change is needed: `open-game-works-core/skills/client-core/modules/scene-core.md:47` and `open-game-works-core/skills/client-core/engines/godot.md:291` already set the `RenderingServer` hiding and that the `visible` of scene code is kept, and the test item `scene-core.md:170` has no test. It is solved by code alone |

## out of scope

- client/godot/core/scene_core/scene_core.gd:665: medium A node that a handler run by the stage 4 hiding removes from the scene before `_hide_tree` walked it is still walked from the copied `get_children()` list and put into `_watched` after `_on_node_removed` erased it, so `_watched` holds a node outside the holder. When that node is then freed, `_check_stopped` (`:773`) stops with "Invalid access to property or key 'process_mode' on a base object of type 'previously freed'" on every frame, and no node gets stopped any more. Run path, in a temporary clone at `5101b3e` with a scratch test: the `ready_hook` of `scene_b` connected `Probe.visibility_changed` to a handler that runs `scene.remove_child(scene.get_node("Spatial"))`; after `wait_trace("prepare:scene_b")` (gate closed) `Spatial` was in `_watched` though not under the holder; the test freed it, added a process counter to the scene root and set it to `PROCESS_MODE_ALWAYS`, and after 3 frames the counter had 10 `_process` calls before stage 7, with 13 script errors. With `scene_core.gd` of `1646bb4` the result was the same, so it existed before the range. The core agent report lists this case in `## unverified`

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | A node of the scene resource with `PROCESS_MODE_ALWAYS` is stopped (`tests/test_scene_holder.gd` passes), but a mode that scene code gives after the stop check ran in a frame still runs `_process` once before stage 7 (see R1-1 in `## previous`). The engine mapping conflict the item names is R2-1 |
| D2 | open | R1-2 | `scene_core.gd:701` and `:744` still write `visible`; a `Probe` hidden in `on_prepare` was visible after the transition. The spec already sets the `RenderingServer` mechanism, so no spec change is needed (see R1-2 in `## previous`) |

## must fix

none

## unknown

- Only the native headless pass was run, and only for single test files (`--file`): `tests/test_scene_holder.gd` at `5101b3e` and with `scene_core.gd` of `1646bb4`, and one scratch test file at both. The whole SceneCore suite, the `--web` run and the modules that depend on SceneCore were not run by this review. The scratch tests ran in a temporary clone under `worktrees/_core/`, deleted after the runs
- Input callbacks of a node given a mode after the nodes of a frame ran (e.g. after `await` on a `SceneTreeTimer`) were not tested
- Processing order for a scene node in a sub-thread `process_thread_group`, and `_integrate_forces` and other physics-server callbacks of a node given a mode during stage 6, were not checked
- A hiding handler that moves (`reparent`) a node not walked yet to another node under the holder was not run; by reading, it is walked once from the copied list and again under its new parent, which only repeats idempotent writes
