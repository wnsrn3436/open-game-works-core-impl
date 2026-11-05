# ShortcutCore review round 4

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R4-1 | spec | medium | client/godot/core/shortcut_core/shortcut_core.gd:142 | Stage 7 of `navigate` now runs `_close_to_root`: after `UICore.close_panels_to(root key)`, while the stack bottom has the root key and other items are above it, it calls `UICore.close_panel` when the top item has the root key and `UICore.close_panels_to(root key)` again otherwise (shortcut_core.gd:143 to :152). The defining document sets stage 7 to one call: "Calls `UICore.close_panels_to` with that root panel key and waits. Stops on `false`" (open-game-works-core/skills/client-core/modules/shortcut-core.md:60). Run path: `start_at(SCENE_ROOT, [PANEL_A, PANEL_R])` (stack r,a,r), `navigate(root_c)` calls `close_panels_to(r)` (no transition, ui-core.md:184), then `close_panel`, which shows A with `prepare(Returned)`/`on_opened(Returned)` (gate `panel_gated:a` in client/godot/core/shortcut_core/tests/test_release.gd:42), then `close_panels_to(r)` again. These extra panel operations, the panel A shown in between, and `release` while waiting on `UICore.close_panel` (tested at test_release.gd:39, not in shortcut-core.md:154) are not in the defining documents. The code is needed to reach the stage 9 stack of shortcut-core.md:67, so stage 7 and stage 9 of the spec cannot both be followed for such a stack; the core agent report (records/1793854391259-review-fix-mw32l6u26d2f7d.md `## spec proposals`) proposes the spec text | Settle stage 7 in shortcut-core.md to the implemented behavior (the report's proposal: repeat `UICore.close_panel` / `UICore.close_panels_to` while the stack bottom is a root panel key item and items remain above it, stop on `false`), add the `## test` item for stack R, A, R, B, R and add `UICore.close_panel` to the `release` test item of shortcut-core.md:154; or add a `UICore` operation that closes to the root item and use it at stage 7 | yes | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-3 | fixed | client/godot/core/shortcut_core/shortcut_core.gd:124 calls `_close_to_root` (:142), which ends with the root item alone under the panel path. `ogw core test godot ShortcutCore` passes on this checkout (ecc2816). Defect restored in a temporary worktree of ecc2816 outside this checkout (worktrees/_core/, removed afterwards) by changing shortcut_core.gd:124 back to `await _wait_for(UICore.close_panels_to.bind(root_key, false))`: `ogw core test godot ShortcutCore` failed in test_stack.gd `test_root_with_root_key_items_above_the_root_item_goes_back_to_the_root_item` (`r,a,r,b,r,c` where `r,c` expected, `r,a,r,b,r,c,b,r` where `r` expected), `test_root_stops_when_going_back_below_a_root_key_item_fails` and test_release.gd `test_release_while_waiting_for_close_panel_below_a_root_key_item` (time limit, stack not `r,a,r` / `r,a`). The stage 7 text that this fix goes beyond is written as R4-1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | fixed | none | The stage 9 stack for a stack with a second root key item above the root item now equals shortcut-core.md:67: stack r,a,r,b,r with `root_c` ends r,c; r,c,b,r with `root_r` ends r; r,a,r with `root_empty` ends r (test_stack.gd:91, passing here, failing with the old stage 7 as in R1-3). The difference between this behavior and the stage 7 text is R4-1 |

## must fix

none

## unknown

- Only the ShortcutCore changes of the range were reviewed (client/godot/core/shortcut_core/). Other changes in the range (SceneCore, CutsceneCore, UnitTestCore, GameUpdateCore tests, server modules, records) are outside this target and were not reviewed; the ShortcutCore suite passed at ecc2816 with the SceneCore changes in place
- `ogw core test godot ShortcutCore` was run natively only, not with `--web`
- `_close_to_root` when the stack bottom has the root key but is not the root item (content code reset the stack and opened the root key with `open_panel`), and when a `close_panels_to` inside the loop (not the first one) fails, have no test; the code paths were read (shortcut_core.gd:146, :151) and each returns `false` or ends the loop as the first `close_panels_to` does, but they were not run
