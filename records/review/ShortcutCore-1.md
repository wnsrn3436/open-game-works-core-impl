# ShortcutCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/shortcut_core/tests/test_errors.gd:136 | Input D1, still present. Stage 5 checks `SceneCore.is_transitioning() or UICore.is_panel_transitioning()` (client/godot/core/shortcut_core/shortcut_core.gd:112), but the only test of the error row `in transition after stage 5` starts a panel transition from the popup hidden callback (`_start_panel_transition`, test_errors.gd:210). The other `SceneCore.change_scene` calls in the tests are awaited setup calls (test_stack.gd:48, test_stack.gd:61, test_open_operation.gd:22) and `_change_scene_later` at test_errors.gd:46/220, which is the stage 1 test. Run path: remove `SceneCore.is_transitioning() or` from shortcut_core.gd:112; no test goes through that condition, so none fails | Add a test whose popup hidden callback starts `SceneCore.change_scene` without awaiting it, and check the warn log, `false`, no `flow:` trace from ShortcutCore and no `ShortcutNavigatedEvent` | no | 90 |
| R1-2 | spec | medium | client/godot/core/shortcut_core/tests/test_stack.gd:68 | Input D2, still present. No test changes the scene at stage 6 into a scene without a root panel, and no test changes the scene with an empty `panels`: all `plain` rows (test-data/data/tables/shortcut.csv:28 to :31) are `Root` and every test using them starts in `SCENE_PLAIN` (test_stack.gd:69, test_empty_panels.gd:22, test_open_operation.gd:41), and `root_empty`, `top_empty`, `plain_empty` (shortcut.csv:22, :27, :31) are used only from their own target scene. So `Top` acting as `Root` in a scene without a root panel (open-game-works-core/skills/client-core/modules/shortcut-core.md:41, :60) and the stage 9 stack "the stack that the new scene's start handling opened" (shortcut-core.md:66, :67) have no test. Run path: change shortcut_core.gd:129 to `row.stack != GameData.ShortcutStack.TOP and root_key == ""`; no test has a `Top` row into a plain scene, so none fails | Add rows `plain` target with `Top` and with empty `panels`, navigated from `SCENE_ROOT`; assert clear stack on (stack is only `panels`) and, for empty `panels`, the stack opened by the new scene's `on_start` | no | 90 |
| R1-3 | spec | medium | client/godot/core/shortcut_core/shortcut_core.gd:124 | Input D3, still present; neither the code nor open-game-works-core/skills/client-core/modules/ui-core.md changed. Stage 7 calls `UICore.close_panels_to(root_key)` (shortcut-core.md:59), whose destination is the topmost item with that key and which returns `true` without a transition when that item is the current panel (ui-core.md:183). `open_panel` pushes a second item with the root key when the current panel is another panel (ui-core.md:163, :164), e.g. via a `Top` row whose `panels` contains the root panel or a `Root` row with `panels` R, B. Then the stage 9 stack differs from shortcut-core.md:66. Reproduced earlier on a scratch copy (D3): from `start_at(SCENE_ROOT, [PANEL_A, PANEL_R])` the stack is r,a,r; `navigate(root_c)` returns `true` with r,a,r,c (spec: r,c) and `navigate(root_r)` returns `true` with r,a,r (spec: r) | Spec decision: give `UICore` a way to return to the root item (e.g. close to the root item rather than to a key), or forbid the root panel key inside `panels` / a non-root item with the root panel key | yes | 85 |
| R1-4 | test evidence | medium | client/godot/core/shortcut_core/shortcut_core.gd:110 | Input D4, still present. shortcut-core.md:72 says `release` stops the move in progress, and `UICore.close_all_popups` calls hidden callbacks synchronously (ui-core.md:197), so a `release` can happen inside stage 5. Every `ShortcutCore.release()` in test_release.gd (:12, :28, :43, :56) and test_lifecycle.gd runs while waiting on an operation or while not navigating. Run path: delete shortcut_core.gd:110 and :111; all tests under client/godot/core/shortcut_core/tests/ still pass (D4 scratch run, 51 tests), while the code would continue to stages 6 to 8 after `release` | Add a test whose popup hidden callback calls `ShortcutCore.release()`; assert `navigate` returns `false`, no scene change, no `flow:` trace, no `ShortcutNavigatedEvent` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | shortcut_core.gd:112 and test_errors.gd unchanged (`git log` shows no commit touching client/godot/core/shortcut_core since the initial commit); still only the panel-transition case at test_errors.gd:136 |
| D2 | open | R1-2 | test_stack.gd, test_empty_panels.gd, test_open_operation.gd and test-data/data/tables/shortcut.csv unchanged; no row into `scene/shortcut_test_plain` with `Top`, no stage 6 change with empty `panels` |
| D3 | open | R1-3 | shortcut_core.gd:121 to :128 unchanged; shortcut-core.md stage 7 and ui-core.md `close_panels_to` destination rule unchanged |
| D4 | open | R1-4 | shortcut_core.gd:110 to :111 unchanged; no `ShortcutCore.release()` from a hidden callback in any test |

## must fix

none

## unknown

- The commit range 1acd0bf..1acd0bf is empty, so no changed code was reviewed; only the input `## debt` items were re-checked
- The Godot test suite was not run in this round. The run paths of D1 to D4 were reproduced by the earlier review on a scratch copy; this round checked by reading that the code, tests, test data and the shortcut-core and ui-core specs at those positions are unchanged
