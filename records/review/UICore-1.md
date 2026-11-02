# review: UICore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/ui_core/tests/test_dimmed.gd:177 | `open-game-works-core/skills/client-core/modules/ui-core.md:216` says a system popup prefab with a `UIPopup` root takes the dim of its root. `test_system_popup_prefab_with_a_popup_root` is the only test of that dim and its root has dim on (`test_popup_dim_tween.tscn`), and `test_system_popup_prefab_without_a_popup_root` does not reach that branch. The other `UIPopup` root prefab runs (`test_back.gd:148`, `test_popup.gd:322`) do not look at the dim. Run in a temporary clone at a362280: `client/godot/core/ui_core/ui_core.gd:1801` `record.dim = prefab_popup.dim` changed to `record.dim = true` makes a system popup whose root has dim off draw a dim, and `ogw core test godot UICore` still passes. Control: the same line as `record.dim = false` fails `test_system_popup_prefab_with_a_popup_root`, so that run used the changed code | Add a test that sets `UICore.systemPopupResource` to a prefab whose `UIPopup` root has dim off (`POPUP_TWEEN` is one), opens a system popup above a panel, and asserts `is_dimmed` `false` for the panel element and `is_modal_covered` `true` | no | 95 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes UICore behavior only by adding `is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `:2374`, `:2379`). The core agent report says the existing dim and system popup code already follows the rules, and that was checked by reading it against `ui-core.md` lines 128 to 132, 216, 461, 467 and 502: `_refresh_popup_layer`, `_refresh_panel_layer`, `_place_below`, `_destroy_record`, `_build_system_popup`, `_close_flow`, `_open_flow`, `_finish_open`, and the back path of system popups.
- Tests run: only `ogw core test godot UICore`, in a temporary clone with the one-line change of R1-1, and again with the control change. The first run passed and the second failed only in the test named in R1-1. The unchanged checkout was not run, and the `QACore` tests (`test_dimmed` in `client/godot/core/qa_core/tests/test_list_ui.gd`) and the modules that depend on UICore were not run. The core agent report states they passed, with the native render pass of `AccessibilityCore`, `NativeUiCore` and `QACore` skipped.
- A `Control` under a `CanvasLayer` that is not a UI layer, such as one a content scene or a panel prefab makes, has layer index -1 in `_layer_index_of` (`ui_core.gd:2336`) and so gives `is_dimmed` `true` under any visible dim, whatever the draw order of that `CanvasLayer`. `QACore` lists such elements, because `visible_elements` walks the whole tree (`client/godot/core/qa_core/dev/qa_query.gd:198`). `is_modal_covered` treats them the same way. `ui-core.md` places the world below all UI layers and does not settle a content `CanvasLayer` drawn above them. No core code or test puts an element there, so no wrong result was reproduced and it is not written as a finding.
- `tools/src/commands/check/lib/ui-quality.ts` of the harness reads `dimmed`. It is outside this target and was not read. Whether the UI quality check passes the popup captures of real games was not checked, as the core agent report also states.
- `uiQuality.maxFlatShare`, removed from `client/godot/generated/core_settings.json` in this range, is no longer named in the harness `skills/`, `tools/src/` or `settings.json`, or in `client/godot/core/` and `core-spec/`. `schemas/` of the harness was not searched.
