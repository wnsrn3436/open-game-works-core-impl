# QACore review round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Native render pass and browser run of QACore: not run in this review. Only `client/godot/core/qa_core/tests/test_list_ui.gd` was run, in the headless native pass, and it passed. The report `records/1793645028102-update-core-mvzlxt6u5be5ef.md` states that the browser run of QACore passed and that the native render pass was `skipped` because the macOS screen was locked or the display was asleep. The range does not change a `test_render_*` file of QACore
- The other test files of QACore and the tests of the modules that depend on it: not run, because no finding needed them
- Parts of QACore that the range does not change or reach (commands other than `list_ui`, channel, telemetry, softlock, debug screen): not read, because the commit range limits this review to the changed places and their callers and callees
- `UICore.is_dimmed` behavior beyond the QACore spec test item: `client/godot/core/ui_core/ui_core.gd` was read for the path that `list_ui` calls, but `client/godot/core/ui_core/tests/test_dimmed.gd` was neither read in full nor run. It belongs to the review of UICore
- Controls in a `CanvasLayer` that is not a UI layer: `_layer_index_of` treats them as the world, so `dimmed` is `true` under any visible dim even when that `CanvasLayer` draws above the dim. No defining document sets the drawing order of such a `CanvasLayer`, and no reproducing use in core was found, so it is not written as a finding
- The result of the harness UI quality check on real games with `dimmed` (e.g. the popup captures named in the report): not run. Only the field read and the contrast skip in `open-game-works-core/tools/src/commands/check/lib/ui-quality.ts` were read
