# ShortcutCore review round 6

## findings

none

## previous

none. The round 5 review file has no findings

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 95fb207..8e137c3 changes only two test files under client/godot/core/shortcut_core/: tests/support/shortcut_probe.gd:34 now traces `flow:<open|close>:<current panel key>:<success>` because `PanelFlowFinishedEvent` lost its `panel_key` field in client/godot/core/ui_core/events/panel_flow_finished_event.gd (ui-core.md gives that event only the open flag and the success flag), and tests/test_errors.gd:206 expects `flow:open:r:false` for the failed open of `root_f`. Every `flow:` assert of the ShortcutCore tests (test_stack.gd, test_release.gd, test_errors.gd, test_empty_panels.gd, test_navigate_order.gd, test_lifecycle.gd) was read against the new meaning: after a successful open the current panel is the opened target, after a close it is the panel closed down to, so each assert still checks the same result. shortcut_core.gd and shortcut_wait.gd are unchanged
- The spec changes of the diff were checked for what they reach in ShortcutCore. ui-core.md: the split error rows (prefab root not `UIPanel` for `open_panel` / `open_panels`, `accepts_param`, `prepare`) all give `false`, and stage 8 stops on `false` (shortcut_core.gd:131 to :135); the `UIOpenedEvent` subscriber rule applies to UICore panel transition operations, and a `navigate` from such a subscriber is refused by stage 1 through `UICore.is_panel_transitioning` (shortcut_core.gd:67), which shortcut-core.md stage 1 sets; the removed system popup area error rows are not used by ShortcutCore. scene-core.md and godot.md scene holder / scene base type, message-core.md tween preset and close wording, localization-core.md destroyed element of `bind_text`, CameraCore, NativeUiCore, RealtimeCore rows: ShortcutCore does not bind text, read tween presets, touch the scene holder or use those modules, and reaches SceneCore and MessageCore only through `SceneCore.change_scene`, `SceneCore.current_scene_key`, `SceneCore.current_root_panel_key`, `SceneCore.is_transitioning` and `MessageCore.show_toast`, whose call forms are unchanged. core/SKILL.md and core/command.md changes are about spec writing and spec review and set nothing in ShortcutCore
- The UICore implementation changes in the range (tween preset loading of panels and system popups, `_loading_system` handled by `close_all_popups`) are outside this target and were not reviewed; ShortcutCore only awaits `UICore.close_all_popups`, `UICore.close_panels_to`, `UICore.close_panel`, `UICore.open_panel` and `UICore.open_panels`, whose signatures did not change
- `ogw core test godot ShortcutCore` passes on this checkout (8e137c3). It was run natively only, not with `--web`
- As in rounds 4 and 5, `_close_to_root` when the stack bottom has the root key but is not the root item, and a failing `close_panels_to` inside the loop (not the first one), have no test; the code paths (shortcut_core.gd:146, :151) were read but not run
