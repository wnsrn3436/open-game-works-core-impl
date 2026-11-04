# SceneCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/scene_core/scene_core.gd:304 | Debt D1 remains: the only stop of the per-frame callbacks from stage 4 until stage 7 is `PROCESS_MODE_DISABLED` on the scene holder, and a node under it with its own `process_mode` (`PROCESS_MODE_ALWAYS`, the documented mode for nodes that run during pause, `open-game-works-core/skills/client-core/engines/godot.md:221`) does not inherit it. This differs from `open-game-works-core/skills/client-core/modules/scene-core.md:47` ("does not receive the per-frame engine callbacks or the input callbacks") and from the mapping `open-game-works-core/skills/client-core/engines/godot.md:203` ("`_process()` ... do not run"). Run path, in a temporary copy of `client/godot/` with a scratch GUT test: `on_preload` of `scene_b` added a `Node` with `process_mode = PROCESS_MODE_ALWAYS` that counts `_process`, `on_prepare` waited on a gate, and after `UnitTestCore.wait_frames(3)` that node had counted 4 `_process` calls while the scene root had counted 0 | At stage 4 and on `SceneTree.node_added` until stage 7, also stop the nodes under the holder whose `process_mode` is not `PROCESS_MODE_INHERIT` (remember the mode, set `PROCESS_MODE_DISABLED`, restore it at stage 7 on the nodes that are `is_instance_valid()`), write that step in the scene holder row of `godot.md`, and add a test with a `PROCESS_MODE_ALWAYS` node under the new scene | no | 95 |
| R1-2 | correctness | medium | client/godot/core/scene_core/scene_core.gd:665 | Debt D2 remains: `_show_hidden` sets `visible = true` on every top visual node that `_hide_if_top` remembered at stage 4 (line 632), without knowing whether scene code hid it after that, so a top visual node that `on_preload` or `on_prepare` hides is shown again at stage 7. Setting `visible = false` on a node SceneCore already hid emits no `visibility_changed`, so the code cannot tell the two apart under the mechanism `open-game-works-core/skills/client-core/engines/godot.md:203` sets, and `open-game-works-core/skills/client-core/modules/scene-core.md:47` does not set the case. Run path, in a temporary copy with a scratch GUT test: `prepare_hook` of `scene_b` set `probe.visible = false`, `change_scene(SCENE_B, null)` returned `true`, and then `probe.visible` was `true` | Set in `scene-core.md` that a visibility change that scene code makes from stage 4 until before stage 7 is kept at stage 7, and change the hiding mechanism of `godot.md` to one that does not write the `visible` of scene nodes, or one that records the value scene code writes (e.g. hide through a parent that SceneCore owns for the 2D nodes and the `CanvasLayer`s, and keep the scene's own `visible` writes to `Node3D`), then add a test that hides a top visual node in `on_prepare` | yes | 90 |
| R1-3 | test evidence | medium | client/godot/core/scene_core/scene_core.gd:346 | Debt D3 remains: the unrecoverable failures "retry popup cannot be opened" and "transition block cannot be set" (`open-game-works-core/skills/client-core/modules/scene-core.md:108`, `:135`, `:137`) have no test. Run path: in a temporary copy, the `_OUTCOME_NOT_OPENED` branch (lines 346 to 348) and both `_block_token == 0` branches (lines 226 to 228 and 353 to 355) were removed, and all 52 tests of `client/godot/core/scene_core/` still passed. The only `fatal_count` asserts are in `client/godot/core/scene_core/tests/test_failure.gd:49` (missing scene resource, root not `SceneBase`), `client/godot/core/scene_core/tests/test_panels.gd:50` (root panel prepare `false`) and `client/godot/core/scene_core/tests/test_transition.gd:168` (boot `on_prepare` `false`) | Add tests where `UICore.open_system_popup` returns `false` for the retry popup and where `InputBlockCore.block` returns 0 at stage 1 and at the retry, each asserting one error log, one `FatalErrorRequestedEvent`, the result `false` and `is_transitioning` `true` | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `client/godot/core/scene_core/scene_core.gd:304` is unchanged; reproduced on the current code: a `PROCESS_MODE_ALWAYS` node under the new scene counted 4 `_process` calls before stage 7 while the scene root counted 0 |
| D2 | open | R1-2 | `client/godot/core/scene_core/scene_core.gd:665` is unchanged; reproduced on the current code: `probe.visible` set to `false` in `on_prepare` was `true` after `change_scene` returned `true` |
| D3 | open | R1-3 | No test in `client/godot/core/scene_core/tests/` reaches the two failures; with the three branches removed, all 52 tests still passed |

## must fix

none

## unknown

- The commit range is empty (`7a4390b..7a4390b`), so there are no changed places; the review covered the code positions of the input `## debt` items and the code they reach in `client/godot/core/scene_core/scene_core.gd` and its tests. Other parts of the module were not reviewed for new problems
- The reproductions ran in a temporary copy whose `generated/` and `build/` folders were copied from `open-game-works-core-impl/client/godot/`, not regenerated for this checkout; the SceneCore code and tests were those of this checkout
- The R1-2 fix direction for `Node3D` was not tried in the engine
