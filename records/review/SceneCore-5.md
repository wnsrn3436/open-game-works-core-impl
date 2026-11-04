# SceneCore review round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Not changed in the range (the range changes only `_hide_tree` and adds `_under_holder`). `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:703`) still writes `process_mode = PROCESS_MODE_DISABLED` (`:707`) on nodes under the holder, against "SceneCore writes no property of a node under the holder" (`open-game-works-core/skills/client-core/engines/godot.md:291`), and `_restore_stopped` (`:749`, `:753`) still replaces a `PROCESS_MODE_DISABLED` that scene code writes. `## spec changes` is `none` and neither `scene-core.md` nor `godot.md` changed since round 4, so the mapping proposed in the core agent report is not settled |
| R2-2 | open | Not changed in the range. `_check_stopped` (`client/godot/core/scene_core/scene_core.gd:790`) still reads `process_mode` of every node in `_watched` (`:794`) from both `_process` and `_physics_process` of `client/godot/core/scene_core/stop_check_node.gd` on every frame from stage 4 until stage 7, so the work per frame grows with the node count of the new scene. The report again disputes only the `spec change: no` label and states the cost is real, so it is not withdrawn; it is closed by the spec decision of R2-1 |
| R1-1 | open | Not changed in the range: a mode that scene code gives a node after the stop check ran in a frame still gets `_process` before stage 7 (round 3 run path), against `open-game-works-core/skills/client-core/modules/scene-core.md:47`. The report's new measurement (no `tree_process_mode_changed` outside the editor, and `can_process()` read per node call) supports that no polling check closes the gap, which is a reason for a spec change, not evidence that the node does not run, so it is not withdrawn. It is closed by the spec decision of R2-1 |
| R1-2 | open | Not changed in the range: `_hide_if_top` still writes `visible = false` (`client/godot/core/scene_core/scene_core.gd:718`, `:723`, `:728`) and `_show_hidden` writes `visible = true` (`:764`, `:766`, `:768`) on every remembered node, so a node that `on_prepare` hides is shown at stage 7. `scene-core.md:47` and `godot.md:291` already set the `RenderingServer` hiding and that the `visible` scene code writes is kept, and the test item `scene-core.md:170` still has no test under `client/godot/core/scene_core/tests/` (no test hides a node in `on_prepare` and checks it after `started`). It is solved by code alone; as the report says, the code position is `_hide_if_top`/`_show_hidden`, not `:665` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | A node with its own `process_mode` in the scene resource or added before stage 7 is disabled by `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:703`) and the stop check, but a mode given between the stop check and the node's own callback in a frame still runs `_process` before stage 7 (R1-1 in `## previous`). The engine mapping conflict the item names is R2-1 |
| D2 | open | R1-2 | `scene_core.gd:718`-`:728` and `:764`-`:768` still write `visible`, so a node hidden in `on_prepare` is visible after the transition (R1-2 in `## previous`). The spec already sets the `RenderingServer` mechanism and the kept `visible`, so no spec change is needed |

## must fix

none

## unknown

- The round 4 `## out of scope` defect (node removed or freed by a stage 4 hiding handler stays in `_watched`) is fixed by the range: in a temporary clone of this checkout at `dc4238e`, `ogw core test godot SceneCore --file client/godot/core/scene_core/tests/test_scene_holder.gd` passed; with `scene_core.gd` of `014a7e9` put back in that clone, `test_node_removed_by_a_handler_of_the_stage_4_hiding_is_not_checked` failed ("the removed node is not in the set", set size 6 vs 5, 8 `_process` and 3 `_physics_process` calls before stage 7, 11 "previously freed" errors) and `test_node_freed_by_a_handler_of_the_stage_4_hiding_is_not_checked` failed (set size 4 vs 5, "Invalid type in function '_hide_if_top'"). The clone was under `worktrees/_core/` and deleted after the runs
- Only the native headless pass of that one test file was run. The whole SceneCore suite, the `--web` run and the modules that depend on SceneCore were not run by this review
- A hiding handler that moves (`reparent`) a node not walked yet to another place under the holder was not run. By reading, `_under_holder` (`client/godot/core/scene_core/scene_core.gd:684`) still returns it, so it is visited from the id list and again by `_on_node_added` or a later walk; `_hide_if_top` and `_stop_if_own_mode` skip a node already hidden or disabled, so the repeat appends nothing
- A handler that frees the node being hidden or disabled from inside its own notification (`visibility_changed` of that node, or its `NOTIFICATION_DISABLED`) was not run; `_hide_if_top` and `_stop_if_own_mode` would append it to `_hidden`/`_stopped` after the write. This code is not changed in the range, and stage 7 skips invalid nodes with `is_instance_valid`
- Nodes that leave the holder before stage 7 stay in `_hidden`/`_stopped`, and stage 7 still writes `visible`/`process_mode` on them; not changed in the range, and part of R1-2 and R2-1
