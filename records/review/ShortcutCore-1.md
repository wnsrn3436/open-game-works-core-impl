# ShortcutCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/shortcut_core/tests/test_errors.gd:136: medium `test evidence`. The only test of the error row `in transition after stage 5` starts a panel transition from the hidden callback (`_start_panel_transition`), and no test starts a scene transition there, so removing `SceneCore.is_transitioning() or` from the stage 5 check in `client/godot/core/shortcut_core/shortcut_core.gd` fails no test. It exists before the range and is unrelated to it (no file under `client/godot/core/shortcut_core/` changed in the range)
- client/godot/core/shortcut_core/tests/test_stack.gd:69: medium `spec`. No test changes the scene at stage 6 into a scene without a root panel, or changes the scene with an empty `panels`: every `plain` row of `test-data/data/tables/shortcut.csv` has `stack` `Root` and starts in `SCENE_PLAIN`, and the rows with an empty `panels` run only from their own target scene. `Top` acting as `Root` there with clear stack on, and the stack that the new scene's start handling opened when `panels` is empty (`open-game-works-core/skills/client-core/modules/shortcut-core.md` `## navigate order`), are therefore not tested. It exists before the range and is unrelated to it
- client/godot/core/shortcut_core/shortcut_core.gd:124: medium `spec`. Stage 7 does not reach the root item when the root panel key is also higher on the stack: `UICore.close_panels_to` picks the topmost item with that key and returns `true` without a transition when it is the current panel (`client/godot/core/ui_core/ui_core.gd:368` to `:376`), so a stack R, A, R stays as it is and differs from the stage 9 stack of `shortcut-core.md` (`panels` on top of the root item, or one root item). A `Top` row or a `Root` row whose `panels` has the root panel makes such a stack. The cause is in the spec of stage 7. It exists before the range and is unrelated to it
- client/godot/core/shortcut_core/shortcut_core.gd:110: medium `test evidence`. No test runs `release` during stage 5, although `shortcut-core.md` `### release` stops the move in progress and `UICore.close_all_popups` calls the hidden callbacks synchronously. All `ShortcutCore.release()` calls of `test_release.gd` and `test_lifecycle.gd` run while the module waits on an operation or while no move runs, so removing the session check after `UICore.close_all_popups()` is not caught by any test that goes through this path. It exists before the range and is unrelated to it

## debt

none

## must fix

none

## unknown

- No file under `client/godot/core/shortcut_core/`, `core-spec/ShortcutCore.json` or `test-data/` changed in the range. The changes that reach the target's dependencies were checked by reading: `MessageCore.show_black_box` lost its extra text and `LocalizationCore.list_languages` changed its buffer type (ShortcutCore and its tests call neither, and `MessageCore.show_toast` is unchanged), `addTableClosure` of `tools/data-tool/src/corespec.ts` now walks the `requirement` table (its only reference is to itself, so the `requirement` column of `shortcut` adds no table), the `godotgen.ts` vector list type (the `shortcut` table has no vector column), and settings keys removed from `client/godot/generated/core_settings.json` (ShortcutCore has no settings)
- `ogw core test godot ShortcutCore` passed on b11113e. `--web` was not run. `tools/data-tool/tests/shortcut-core-check.test.ts` was read and not run
- The four `## out of scope` lines are at the locations of the items D1 to D4 of `records/review-debt/ShortcutCore.json`, which this round's input does not give as scope. They were rechecked by reading the code and tests at b11113e, without restoring a defect in a temporary copy or running the reproduction of the stack R, A, R
- Input `## spec changes` is `none`, so the defining documents were not compared with the code for changes to them. The defining documents other than the ShortcutCore spec were read only for the operations ShortcutCore calls
