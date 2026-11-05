# SceneCore review round 8

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | No file under `client/godot/core/scene_core/` changed in the range (`git diff ecc2816..b8f5a58 -- client/godot/core/scene_core` is empty), and the core agent report says it made no code change. `scene-core.md:47`, the test item `scene-core.md:171` and the scene holder row `godot.md:291` (`open-game-works-core/skills/client-core/`) are also unchanged since round 7 (input `## spec changes` is `none`). So the round 7 run path still applies to the same code: a node added under the holder with `PROCESS_MODE_INHERIT`, given `PROCESS_MODE_ALWAYS` by scene code after `node_added` and before stage 7, receives `_process` while the scene root does not (3 calls in 3 frames in round 7). `_stop_if_own_mode` (`client/godot/core/scene_core/scene_core.gd:664`) reads `process_mode` only right after the stage 4 `add_child()` and in `_on_node_added` (`scene_core.gd:731`). The report disputes the finding, but its evidence (Godot gives no other object a signal for a mode change, and `godot.md:291` allows reading `process_mode` only at those times) shows that the defining documents conflict for this case, not that the node does not run. So the finding is not withdrawn. It is solved only by a change to the defining documents (`spec change: yes`), e.g. the report's `## spec proposals`, which is a decision for the lead or the human. Severity stays `medium` (differs from the defining documents) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | Code unchanged since round 7. A node added with `PROCESS_MODE_ALWAYS` before stage 7 is disabled by `_on_node_added` (`client/godot/core/scene_core/scene_core.gd:731`) through `_stop_if_own_mode` (`scene_core.gd:664`), covered by `test_nodes_with_a_process_mode_of_their_own_run_frames_only_after_stage_7` (`client/godot/core/scene_core/tests/test_scene_holder.gd:101`). The item's problem remains for a mode that scene code gives a node after it was added, which is R1-1, open in `## previous` |

## must fix

none

## unknown

- No test was run in this round. SceneCore code is byte-identical to the code that the round 7 review tested and on which it reproduced R1-1, so R1-1 and D1 are judged from that run and from the unchanged code, not from a new run
- In the range, the only changed module that SceneCore calls is MessageCore (`client/godot/core/message_core/message_core.gd`). SceneCore calls `MessageCore.close_black_box()` at stage 1 (`client/godot/core/scene_core/scene_core.gd:233`) and `MessageCore.init`/`prepare` in its test support (`client/godot/core/scene_core/tests/support/scene_case.gd:113`, `:126`). The changes to `_close_kind` are comments only, and `_drop_destroyed` now logs per kind. The black box lives under MessageCore's own holder (`message_core.gd:70`), not under the scene holder, so a transition does not destroy it. I found no change of SceneCore behavior from this, but did not run the SceneCore tests against it. The MessageCore changes themselves are reviewed in `records/review/MessageCore-1.md`
- The other changes in the range (records, review debt files) were not read: they are not code of SceneCore and SceneCore calls none of them
- Carried over and not run in the engine: a `CanvasItem` with `top_level = true` under a hidden `CanvasItem`, a `Window` or `SubViewport` under the scene holder, and a remembered node that scene code moves out of the holder before stage 7 (read from `scene_core.gd:708`, matches the "remembered nodes that are `is_instance_valid()`" wording of `godot.md:291`)
