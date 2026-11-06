# RequirementCore review round 1

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

- Commit range 97851fcb..8233b525 changes, under `client/`, only `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd` and three UICore tests (key direction focus start deferred to `_start_focus`, `_focus_start_pending`, system popup body scroll consumed in `_on_unhandled_input`, `SystemPopupView.scroll_by` now returns bool). No file of `client/godot/core/requirement_core/` and no event definition changed, and `## spec changes` is `none`
- RequirementCore depends on UICore only through `UIOpenedEvent` and `UIClosedEvent` (`client/godot/core/requirement_core/requirement_core_node.gd:39`, `client/godot/core/requirement_core/requirement_core_node.gd:43`). The changed UICore code does not publish or change those events (`client/godot/core/ui_core/ui_core.gd:1570`, `client/godot/core/ui_core/ui_core.gd:1578` are unchanged), and the RequirementCore trigger tests publish those events directly (`client/godot/core/requirement_core/tests/support/requirement_test_case.gd:242`), so no RequirementCore behavior is reached by the changes
- The RequirementCore core tests were not run: this checkout has no GUT addon installed (`client/godot/addons` is absent), and no changed code is reached by them
- RequirementCore code that the range does not change was not reviewed again, because only problems that the changes of the range cause or reveal are findings for this round
