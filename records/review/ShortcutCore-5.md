# ShortcutCore review round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | The spec changes settle stage 7 to the implemented behavior: shortcut-core.md stage 7 now calls `UICore.close_panels_to` with the root panel key and then, while the bottom item of `UICore.get_panel_stack` has the root panel key and other items are above it, `UICore.close_panel` when the current panel has the root key and `UICore.close_panels_to` otherwise, stopping on `false`. client/godot/core/shortcut_core/shortcut_core.gd:142 to :152 does exactly that (first `close_panels_to`, loop on `keys.size() > 1 and keys[0] == root_key`, `close_panel` when `keys[last] == root_key`, `close_panels_to` otherwise, `false` on a failed operation or a changed session). The stopped-move rule now names stage 7 ("does not reopen the panels closed at stage 7"), and the code reopens nothing. The new `## test` item for stack R, A, R, B, R is checked by client/godot/core/shortcut_core/tests/test_stack.gd:91 (`root_c` ends `r,c` with one open flow of C) and the R, A, R item with `prepare(Returned)` of A `false` by test_stack.gd:117 (result 0, no open flow, stack `r,a,r`, no `ShortcutNavigatedEvent`). The `release` item now lists `UICore.close_panel`, checked by client/godot/core/shortcut_core/tests/test_release.gd:39. `ogw core test godot ShortcutCore` passes on this checkout (95fb207). The defect restoration of R1-3 in round 4 showed these tests fail with stage 7 as a single `close_panels_to` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range ecc2816..95fb207 changes no file under client/godot/core/shortcut_core/. The review covered the ShortcutCore code and tests that the changed shortcut-core.md definitions reach (stage 7, the stopped-move rule, the two new `## test` items, the `release` item) and the dependency spec changes of the diff (ui-core.md event order with `PanelFlowFinishedEvent`, scene-core.md scene holder and `release`, localization-core.md `bind_text` / `unbind_text`, message-core.md tween preset length, godot.md CameraCore and others). ShortcutCore does not subscribe to `UIOpenedEvent` or `PanelFlowFinishedEvent`, does not bind text and does not read tween presets, so those changes reach it only through the awaited `SceneCore` / `UICore` operations, whose implementations are outside this target and were not reviewed
- The `## test` item for stack R, A, R, B, R names that stack also for `panels` only R and empty. test_stack.gd:103 runs `root_r` from `r,c,b,r` and test_stack.gd:110 runs `root_empty` from `r,a,r`, not from `r,a,r,b,r`. Stage 7 is the same code for all three rows (shortcut_core.gd:124) and the loop over two root key items above the root item is run by `root_c` at test_stack.gd:95, so this is not written as a finding
- `ogw core test godot ShortcutCore` was run natively only, not with `--web`
- As in round 4, `_close_to_root` when the stack bottom has the root key but is not the root item, and a failing `close_panels_to` inside the loop (not the first one), have no test; the code paths (shortcut_core.gd:146, :151) were read but not run
