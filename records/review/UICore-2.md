# review: UICore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/ui_core/tests/test_dimmed.gd:201` `test_system_popup_prefab_with_a_popup_root_with_dim_off` sets `UICore.systemPopupResource` to `POPUP_TWEEN`, whose root in `client/godot/core/ui_core/tests/resources/test_popup_tween.tscn` is a `UIPopup` that leaves `dim` at its default `false` (`client/godot/core/ui_core/ui_popup.gd:11`), opens a system popup above a panel, and asserts `is_dimmed` `false` and `is_modal_covered` `true` for the panel button. Defect restored in a temporary clone of ecdec32: `client/godot/core/ui_core/ui_core.gd` `record.dim = prefab_popup.dim` changed to `record.dim = true`. `ogw core test godot UICore --file client/godot/core/ui_core/tests/test_dimmed.gd` then exited 1 with 13 of 14 passed, and the only failure was `test_system_popup_prefab_with_a_popup_root_with_dim_off` at "the dim of the root is off". With that change reverted, `ogw core test godot UICore` ran with an untracked file in the clone, so no kept result was used, and exited 0 with 181 of 181 passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes one code file, `client/godot/core/ui_core/tests/test_dimmed.gd`, by adding one test. The rest of the range is records. That test and the code it runs were read: `open_system_popup`, `_build_system_popup`, `_refresh_popup_layer`, `is_dimmed`, `_is_dimmed`, `_dim_above`, `is_modal_covered`, `_is_covered`, and the test helpers it uses. Other UICore code was not reviewed in this round.
- Tests run: only the runs in `## previous`. The modules that depend on UICore and the browser run (`--web`) were not run. The core agent report states they passed on ceac68f, with the native render pass of `AccessibilityCore`, `NativeUiCore` and `QACore` skipped because the screen was locked or the display was asleep. That render pass was not checked in this round either.
- An earlier `ogw core test godot UICore --file` run in this round gave 14 of 14 passed but is not evidence. Its temporary clone was under the scratchpad directory, outside `worktrees/_core/`, so `resolveCoreImpl` (`open-game-works-core/tools/src/lib/game.ts:45`) ran the test on the main checkout without the restored defect. The main checkout stayed clean at ecdec32 after that run. The runs in `## previous` used a clone under `worktrees/_core/`, which was deleted afterwards.
- `records/review-debt/UICore.json` holds D1 (`is_dimmed` and the dim of a tutorial step, found by TutorialCore round 1). It is not in input `## debt`, because `scopeDebt` (`open-game-works-core/tools/src/commands/review/lib/debt.ts:98`) gives only the items that were in the list when the review began. D1 was not judged in this round and is not rewritten in `## out of scope`, since it is already on the list.
- The other items of `## unknown` of `records/review/UICore-1.md` were not checked again: a `Control` under a `CanvasLayer` that is not a UI layer, `tools/src/commands/check/lib/ui-quality.ts` of the harness, and `schemas/` of the harness for `uiQuality.maxFlatShare`. This range does not change them.
