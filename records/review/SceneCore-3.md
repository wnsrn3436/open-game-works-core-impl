# SceneCore review round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | correctness | medium | client/godot/core/scene_core/scene_core.gd:334 | Commit `3c0e50f` replaced the per-frame tree walk with the `_watched` set, but `_set_watching(true)` runs only after `_hide_tree(_holder)` (line 333), and `_on_node_added` adds to the set only `if _watching` (line 753). `_hide_tree` writes `visible = false` (line 699) and `process_mode` (line 683), which notify scene code synchronously (`visibility_changed`, `NOTIFICATION_DISABLED`). A node that such a handler adds to a node whose children `_hide_tree` already listed (e.g. the scene root) is hidden and stopped once by `_on_node_added`, but it is never put in `_watched` and is not walked, so a mode that scene code gives it later is never stopped and it runs `_process` before stage 7, against `open-game-works-core/skills/client-core/modules/scene-core.md:47`. Before the range the per-frame `_stop_tree` walk caught it. Run path, in a temporary clone of this checkout at `1646bb4` with a scratch test run by `ogw core test godot SceneCore --file`: the `_ready` of `scene_b` connected `Probe.visibility_changed` to a handler that adds one process counter to the scene root; after `wait_trace("prepare:scene_b")` (gate closed) the test set that counter to `PROCESS_MODE_ALWAYS`, and after `UnitTestCore.wait_frames(3)` it had counted 3 `_process` calls before stage 7. The same test passed at `b1dfb06` | Put every node `_on_node_added` handles into `_watched` while `_hiding` (or set `_watching` before `_hide_tree`), and add a test where a handler run by the stage 4 hiding adds a node that later gets a mode of its own | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Commit `3c0e50f` did not change the mechanism: `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:683`) still writes `PROCESS_MODE_DISABLED` on nodes under the holder, against "SceneCore writes no property of a node under the holder" (`open-game-works-core/skills/client-core/engines/godot.md:291`), and `_restore_stopped` (`:725`) still replaces a `PROCESS_MODE_DISABLED` that scene code writes. Rerun in a temporary clone at `1646bb4` with a scratch test: `prepare_hook` of `scene_b` set `Counter` (`process_mode = 3` in `tests/resources/scene_b.tscn`) to `PROCESS_MODE_DISABLED`, `change_scene(SCENE_B, null)` returned `true`, and then `Counter.process_mode` was 3, not 4. `## spec changes` is `none`, so the Godot mapping is not settled yet; the core agent report states it as a spec proposal |
| R2-2 | open | The second part is fixed: `_set_watching(false)` at stage 7, in `_fail` and in `_end_with_restart` stops the stop check node (tested by `tests/test_scene_holder.gd:185`). The finding itself stays: `_check_stopped` (`client/godot/core/scene_core/scene_core.gd:770`) still reads `process_mode` of every node in `_watched`, which holds every node under the holder, from both `_process` and `_physics_process` of `stop_check_node.gd` on every frame from stage 4 to stage 7, including the waits on `on_prepare` and the retry popup. The work per frame still grows linearly with the node count of the new scene, as the core agent report states (154 µs per check at 2800 nodes in its scratch measurement). A check that does not touch every node needs the spec decision the report proposes together with R2-1 |
| R1-1 | open | The `process_priority` run path of round 2 is fixed: the stop check node runs at the lowest priority (`client/godot/core/scene_core/scene_core.gd:25`), and `tests/test_scene_holder.gd:97` covers it. The defect remains for a mode that scene code gives inside a frame after the stop check ran: run path, in a temporary clone at `1646bb4` with a scratch test, `preload_hook` of `scene_b` added a process counter with `process_priority = 100`; after `wait_trace("prepare:scene_b")` (gate closed) the test awaited the `ticked` signal that a node outside the holder (`process_priority = -100`, `PROCESS_MODE_ALWAYS`) emits from its `_process`, set the counter to `PROCESS_MODE_ALWAYS` (scene code resuming from an `await` on a signal emitted in another node's callback, e.g. a response delivered from `_process`), and after `await tree.process_frame` the counter had counted 1 `_process` call before stage 7, against `open-game-works-core/skills/client-core/modules/scene-core.md:47`. At `b1dfb06` this run passed, because the check then ran at priority 0, between the two nodes; the gap moved and was not closed. The core agent report lists this case in `## unverified` and proposes settling it with R2-1 |
| R1-2 | open | `client/godot/core/scene_core/scene_core.gd:699` still sets `visible = false` and `_show_hidden` (`:740` to `:744`) still sets `visible = true` on every remembered node. Rerun in a temporary clone at `1646bb4` with a scratch test: `prepare_hook` of `scene_b` set `Probe.visible = false`, `change_scene(SCENE_B, null)` returned `true`, and then `Probe.visible` was `true`. The core agent did not fix it because the input line said a spec change is needed, but the defining documents already settle it: `open-game-works-core/skills/client-core/modules/scene-core.md:47` (scene code hides kept, no visibility flag changed), `open-game-works-core/skills/client-core/engines/godot.md:291` (hide with `RenderingServer.canvas_item_set_visibility_layer` / `instance_set_layer_mask`, restore to the node's own `visibility_layer` / `layers`) and the test item `scene-core.md:170`, which no test covers. It is solved by code alone |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | A `PROCESS_MODE_ALWAYS` node of the scene resource is stopped now, but a node that scene code gives a mode of its own inside a frame, after the stop check ran, still runs `_process` once before stage 7 (see R1-1 in `## previous`). The engine mapping conflict the item names is R2-1 |
| D2 | open | R1-2 | `scene_core.gd:699` and `:740` to `:744` still write `visible`; a `Probe` hidden in `on_prepare` was visible after the transition. The spec already gives the `RenderingServer` mechanism, so no spec change is needed (see R1-2 in `## previous`) |

## must fix

none

## unknown

- Only the native headless pass was run, and only for the scratch test file (`--file`) at `1646bb4` and at `b1dfb06`. The whole SceneCore suite, the `--web` run and the modules that depend on SceneCore were not run by this review. The scratch tests used a temporary clone under `worktrees/_core/` with a `ready_hook` added to `tests/support/scene_stub.gd`; the clone was deleted after the runs
- Input callbacks were not tested: a mode that scene code gives after the nodes of a frame ran (e.g. after `await` on a `SceneTreeTimer`, whose timeouts run after node processing) may let that node receive input events dispatched at the start of the next iteration, before the next stop check. Not reproduced
- Processing order for a scene node in a sub-thread `process_thread_group` was not checked
- `_integrate_forces` and other physics-server callbacks of a node given a mode during stage 6 were not checked
