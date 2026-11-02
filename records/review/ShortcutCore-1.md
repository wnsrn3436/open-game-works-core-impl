# ShortcutCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/shortcut_core/tests/test_errors.gd:136: medium `test evidence`. Stage 5 of `navigate` checks both `SceneCore.is_transitioning` and `UICore.is_panel_transitioning` (`client/godot/core/shortcut_core/shortcut_core.gd:112`), and the error table row `in transition after stage 5` covers both, but the only test of that row starts a panel transition from the popup hidden callback (`_start_panel_transition`, test_errors.gd:210). No test under `client/godot/core/shortcut_core/tests/` starts a scene transition from a hidden callback: the other `change_scene` calls in the tests are the awaited setup calls of test_stack.gd:48, test_stack.gd:61 and test_open_operation.gd:22, and `_change_scene_later` at test_errors.gd:46, which is the stage 1 test. Run path: remove `SceneCore.is_transitioning() or` from shortcut_core.gd:112, and no test goes through the removed condition, so no test fails. This exists before the range and is unrelated to it
- client/godot/core/shortcut_core/tests/test_stack.gd:69: medium `spec`. The rules for a scene changed at stage 6 into a scene without a root panel have no test, nor does a scene change with an empty `panels`: `Top` acting as `Root` there, with clear stack on (`open-game-works-core/skills/client-core/modules/shortcut-core.md:41`, `shortcut-core.md:60`), and the stack that the new scene's start handling opened when `panels` is empty (`shortcut-core.md:66`, `shortcut-core.md:67`). All `plain` rows of `test-data/data/tables/shortcut.csv:28` to `:31` have `stack` `Root`, and each test that uses them starts in `SCENE_PLAIN` (test_stack.gd:69, test_empty_panels.gd:22, test_open_operation.gd:41), so stage 6 is skipped. The rows with an empty `panels` (`root_empty`, `top_empty`, `plain_empty`) are also used only from their own target scene. Run path: change `client/godot/core/shortcut_core/shortcut_core.gd:129` to `row.stack != GameData.ShortcutStack.TOP and root_key == ""`, so that a `Top` row into a scene without a root panel opens on the stack from `on_start`, and no test has such a row, so no test fails. The current code follows the spec; only the test is missing. This exists before the range and is unrelated to it

## debt

none

## must fix

none

## unknown

- The commit range d4c3ae7f..0c3d7595 changes no file under `client/godot/core/shortcut_core/`, no `core-spec/ShortcutCore.json`, no file under `test-data/` or `tools/`, no generated data code, and no folder of `LogCore`, `EventCore`, `DataCore`, `LocalizationCore`, `RequirementCore`, `MessageCore` or `SceneCore`. `## spec changes` is `none`. In the dependency `UICore` it adds only `is_dimmed` and the private `_is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`), plus a comment wording change. ShortcutCore calls none of them, and the `UICore` operations it calls (`is_panel_transitioning`, `close_all_popups`, `close_panels_to`, `open_panel`, `open_panels`) are unchanged. The other code changes in the range are the `QACore` `dimmed` field of `list_ui`, test files of `QACore` and `UICore`, the `UICore` `core-spec` row, and the removal of `maxFlatShare` from `client/godot/generated/core_settings.json`, which ShortcutCore does not read. So the range causes or reveals no ShortcutCore problem
- `ogw core test godot ShortcutCore` ended with `ShortcutCore pass`. The output does not say whether the module ran or a kept passing result with the same key was reused
- The two run paths in `## out of scope` were judged by reading all test files and the test rows of the `shortcut` table. The changed code was not run: `ogw core test` runs only from a checkout under the worktree folder, so it was not run on a temporary copy
- `release` called synchronously inside a popup hidden callback during stage 5 (the session check at `client/godot/core/shortcut_core/shortcut_core.gd:110`) has no test. It was not written as a problem because no module's path that calls `ShortcutCore.release` from a hidden callback was traced, so whether normal code reaches it is not checked
- The implementation of the `UICore`, `SceneCore`, `RequirementCore` and `MessageCore` operations that ShortcutCore calls was not read; their specs were read only for the operations ShortcutCore calls. The browser run (`--web`) was not run
