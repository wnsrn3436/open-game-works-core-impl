# SceneCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/scene_core/scene_core.gd:653 | The fix of R1-1 (commit `782e069`) writes `process_mode` on nodes under the scene holder (`_stop_if_own_mode` sets `PROCESS_MODE_DISABLED`, `_restore_stopped` at line 699 writes the kept mode back at stage 7). The scene holder row of `open-game-works-core/skills/client-core/engines/godot.md:291` says "SceneCore writes no property of a node under the holder", and that same row says `_process()` and `_physics_process()` do not run under the holder, which a `PROCESS_MODE_ALWAYS` node does unless its own `process_mode` is written: the two sentences cannot both hold, so the mapping has to be settled. The write also loses a scene-code change: `_restore_stopped` cannot tell the `PROCESS_MODE_DISABLED` it wrote from one scene code writes. Run path, in a temporary clone of this checkout at `b1dfb06` with a scratch test run by `ogw core test godot SceneCore --file`: `prepare_hook` of `scene_b` set `Counter` (`process_mode = 3` in `tests/resources/scene_b.tscn`) to `PROCESS_MODE_DISABLED`, `change_scene(SCENE_B, null)` returned `true`, and then `Counter.process_mode` was 3 (`PROCESS_MODE_ALWAYS`), not 4 | Settle the Godot mapping in `godot.md:291`: either allow SceneCore to write `process_mode` under the holder (the step the core agent proposed in `records/1793821251771-review-fix-mw2iuw8rb95b11.md`) and set in `scene-core.md` `### scene` that a run-mode change scene code makes from stage 4 until before stage 7 is kept at stage 7, as for visibility, or set another mechanism. Then make the code keep a scene-code write and add a test where `on_prepare` disables a node that SceneCore stopped | yes | 90 |
| R2-2 | efficiency | medium | client/godot/core/scene_core/scene_core.gd:729 | `_check_stopped` calls `_stop_tree(_holder)`, a recursive walk of every node under the scene holder, from both `_process` and `_physics_process` of the core node (`client/godot/core/scene_core/scene_core_node.gd:7`, `:12`) on every frame while `_hiding` is `true`. That is the whole of stages 4 to 6, including the wait on `on_prepare` (server requests) and on the retry popup, and after a fatal failure or a restart at stage 5 or 6 until `release`, because `_fail` and `_end_with_restart` do not reset `_hiding`. The work per frame grows with the node count of the new scene (two full walks per rendered frame at the default physics rate), while the loading screen is animating on screen | Settle with R2-1 a mechanism that does not walk the whole new scene each frame (e.g. stop only the nodes `node_added` and the walks after stage 4 and `on_preload` report, and set in the spec what happens to a mode scene code gives after `on_preload` returns), and stop the frame check when the transition stops | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | The run path of round 1 is fixed: `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:649`) stops a `PROCESS_MODE_ALWAYS` node of the scene resource or one `on_preload` adds, and `tests/test_scene_holder.gd:57` covers it. The defect remains for a node whose `process_priority` is lower than the core node's (0): the per-frame walk runs in the core node's `_process`, after that node's `_process`. Run path, in a temporary clone at `b1dfb06` with a scratch test: `preload_hook` of `scene_b` added a process counter with `process_priority = -1` and the default `PROCESS_MODE_INHERIT`, `on_prepare` waited on a gate, the test then set that node to `PROCESS_MODE_ALWAYS` (scene code after an `await` in `on_prepare`), and after `UnitTestCore.wait_frames(3)` it had counted 1 `_process` call before stage 7, against `open-game-works-core/skills/client-core/modules/scene-core.md:47` ("does not receive the per-frame engine callbacks"). The core agent report lists this case and the mid-frame case in `## unverified`. The fix depends on the mapping that R2-1 settles |
| R1-2 | open | `client/godot/core/scene_core/scene_core.gd:669` still sets `visible = false` and `_show_hidden` (`:712`) sets `visible = true` on every remembered node. Reproduced in a temporary clone at `b1dfb06` with a scratch test: `prepare_hook` of `scene_b` set `Probe.visible = false`, `change_scene(SCENE_B, null)` returned `true`, and then `Probe.visible` was `true`. The defining documents now settle the case: `open-game-works-core/skills/client-core/modules/scene-core.md:47` says SceneCore hides the scene without changing the visibility flag of any object and an object that scene code hid stays hidden, `open-game-works-core/skills/client-core/engines/godot.md:291` sets the mechanism (`RenderingServer.canvas_item_set_visibility_layer(get_canvas_item(), 0)` for top `CanvasItem`s, `RenderingServer.instance_set_layer_mask(get_instance(), 0)` for `VisualInstance3D`, restore to the node's own `visibility_layer` or `layers`), and `scene-core.md:170` adds a test item that no test covers. So this finding is now solved by code alone, without a spec change: implement that mechanism and add the `scene-core.md:170` test |
| R1-3 | fixed | Tests added at `client/godot/core/scene_core/tests/test_failure.gd:26`, `:42` and `:68`. In a temporary clone at `b1dfb06`, the `_OUTCOME_NOT_OPENED` branch (`scene_core.gd:352` to `:354`) and both `_block_token == 0` branches (`:230` to `:232`, `:359` to `:361`) were deleted, and `ogw core test godot SceneCore --file client/godot/core/scene_core/tests/test_failure.gd` failed all three new tests (`test_transition_block_that_cannot_be_set_in_stage_1_is_fatal`: 0 SceneCore errors and 0 fatal events, expected 1; `test_transition_block_that_cannot_be_set_again_at_the_retry_is_fatal`: result 1, expected 0, no fatal event; `test_retry_popup_that_cannot_be_opened_is_fatal`: no fatal event, restart count 1). On the unchanged code, `ogw core test godot SceneCore` passed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The case of the item (a `PROCESS_MODE_ALWAYS` node in the new scene) is stopped now, but a node with `process_priority` below 0 that scene code gives a mode of its own during stage 6 still ran `_process` once before stage 7 (see R1-1 in `## previous`) |
| D2 | open | R1-2 | `scene_core.gd:669` and `:712` still write `visible`; a `Probe` hidden in `on_prepare` was visible after the transition (see R1-2 in `## previous`) |
| D3 | fixed | none | The three new tests in `tests/test_failure.gd` fail with the three branches deleted (see R1-3 in `## previous`) |

## must fix

none

## unknown

- Only the native headless pass was run, for `client/godot/core/scene_core/tests/` (the whole module through `ogw core test godot SceneCore` at `b1dfb06`) and for the scratch tests and `test_failure.gd` (`--file`). The `--web` run and the modules that depend on SceneCore were not run by this review
- The mid-frame case of the core agent report (scene code gives a node a mode of its own after an `await` resumes inside a frame, after the core node ran) was not reproduced separately; the `process_priority` run path shows the same gap
- The per-frame cost of R2-2 was not measured; the finding rests on the code path
- The temporary clones were made under `worktrees/_core/`, because `ogw core test` takes a non-main core checkout only there, and were deleted after the runs
