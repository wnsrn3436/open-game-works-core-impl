# review: ShortcutCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/shortcut_core/shortcut_core.gd:124: medium Stage 7 does not reach the root item when the root panel key is also higher on the stack, so the stack at stage 9 differs from `open-game-works-core/skills/client-core/modules/shortcut-core.md:66` (`panels` on top of the root item, or one root item). The cause is in the spec: stage 7 (`shortcut-core.md:59`) calls `UICore.close_panels_to` with the root panel key, and `open-game-works-core/skills/client-core/modules/ui-core.md:183` sets its destination to the topmost item with that key and returns `true` without a transition when that item is the current panel. `open_panel` pushes a second item with the root key when the current panel is another panel (`ui-core.md:163`, `ui-core.md:164`). A `Top` row whose `panels` has the root panel, or a `Root` row whose `panels` is R, B, makes such a stack. Reproduced on a scratch copy: from `start_at(SCENE_ROOT, [PANEL_A, PANEL_R])` the stack is r,a,r; `navigate` of `root_c` returns `true` with stack r,a,r,c (expected r,c), and `navigate` of `root_r` returns `true` with stack r,a,r (expected r). The direction of the fix needs a spec decision: a `UICore` way to return to the root item, or a rule that forbids the root panel key in `panels`
- client/godot/core/shortcut_core/shortcut_core.gd:110: medium `test evidence`. No test goes through a `release` during stage 5, although `open-game-works-core/skills/client-core/modules/shortcut-core.md:72` says `release` stops the move in progress and `UICore.close_all_popups` calls the hidden callbacks synchronously (`open-game-works-core/skills/client-core/modules/ui-core.md:197`). All `ShortcutCore.release()` calls of `client/godot/core/shortcut_core/tests/test_release.gd` and `test_lifecycle.gd` run while the module waits on an operation or while no move runs. Run path: on a scratch copy, deleting lines 110 and 111 leaves all 51 tests of `client/godot/core/shortcut_core/tests/` passing, while the code would then go on to stages 6 to 8 after `release`
- client/godot/core/shortcut_core/tests/test_errors.gd:136: medium `test evidence`. The same as D1 of `records/review-debt/ShortcutCore.json`, which is still there. The error table row `in transition after stage 5` covers both transitions, and the only test of it starts a panel transition from the hidden callback. Run path: on a scratch copy, removing `SceneCore.is_transitioning() or` from `client/godot/core/shortcut_core/shortcut_core.gd:112` leaves all 51 tests passing
- client/godot/core/shortcut_core/tests/test_stack.gd:69: medium `spec`. The same as D2 of `records/review-debt/ShortcutCore.json`, which is still there. A scene change at stage 6 into a scene without a root panel has no test: `Top` acting as `Root` with clear stack on (`open-game-works-core/skills/client-core/modules/shortcut-core.md:41`, `shortcut-core.md:60`), and the stack from the new scene's start handling when `panels` is empty (`shortcut-core.md:67`). All `plain` rows of `test-data/data/tables/shortcut.csv` have `stack` `Root` and are used only from `SCENE_PLAIN`. Run path: on a scratch copy, changing `client/godot/core/shortcut_core/shortcut_core.gd:129` to `row.stack != GameData.ShortcutStack.TOP and root_key == ""` leaves all 51 tests passing. The current code follows the spec; only the test is missing

## debt

none

## must fix

none

## unknown

- The commit range changes no file of `client/godot/core/shortcut_core/`. Its only code changes are `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd:714` and its tests. `ShortcutCore` uses `LocalizationCore` only for the `FormatArgs` type, and its tests call `init`, `resolve_language`, `load_translation` and `format`. `_restore_heading_types` runs only when `_heading_chain` is set (`localization_core.gd:853`), which `load_fonts` does, and nothing under `client/godot/core/shortcut_core/` calls `load_fonts`. So the range causes and reveals no finding here. This reach was checked by reading and search
- `ogw core test godot ShortcutCore` passes on the target commit, but the result was reused from a passing result of the same key, not run again. The browser run (`--web`) was not run in this review
- The runs on the scratch copy called `godot` directly with a test run config without a test host. The mutated run printed 51 of 51 tests passing and `All tests passed`, and the process exit code was 1. I did not check the cause of that exit code; the likely reason is the missing test host. The three mutations of the items above were applied together in one run, not one at a time. The checkout under review was not changed
- D1 and D2 are in `## out of scope` because input `## debt` is `none` for this review. The same location is already in the debt list, so `ogw review wait` adds nothing for them
- A param builder that calls `ShortcutCore.release()` during stage 4 was not run. From reading, `_run` has no session check between stage 4 and `UICore.close_all_popups`, so popups would still close after that `release`. It is not written as a problem, because no core code path was found that releases the module from inside a param builder, and whether content code may do so was not settled
- `tools/data-tool/tests/shortcut-core-check.test.ts` was read and not run in this review
- Real device behavior and panels and scenes of a game were not run. Only the test resources of `client/godot/core/shortcut_core/tests/resources/` were used
