# review UICore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `test_back_while_a_system_popup_loads_its_tween_presets_keeps_a_close_popup` and `test_back_while_a_system_popup_loads_its_tween_presets_opens_no_exit_confirm` (client/godot/core/ui_core/tests/test_back.gd:160,176) send back input while `_loading_system` is not empty and `is_system_popup_visible()` is `false`, and assert the result, that the `Close` popup stays open and that no exit confirm opens. Restored the defect in a temporary clone of this checkout at 92e208b (outside it, deleted after): removed lines 2084-2085 (`if not _loading_system.is_empty(): return true`) of client/godot/core/ui_core/ui_core.gd and ran `ogw core test godot UICore --file client/godot/core/ui_core/tests/test_back.gd`: both new tests failed ("Expected [<null>] to be anything but NULL: the popup whose back policy is Close stays open"; "[2] expected to equal [1]: no exit confirm") and no other test of that file failed |
| R1-2 | fixed | client/godot/core/ui_core/system_popup_view.gd:66-99,127-141: buttons have no fixed minimum height and clip their labels with an ellipsis, and `_fit_row` (connected to the area's `resized` and the row's `minimum_size_changed`) sizes the row to the area and scales it down uniformly when its combined minimum size is still larger, so its global rectangle equals the area rectangle. New tests `test_buttons_stay_inside_a_button_area_smaller_than_their_minimum_size` (90×24 area, long labels, then 40×8) and `test_long_labels_stay_inside_the_root_strip` (tests/test_system_popup.gd:122,141) pass on the current code; with the system_popup_view.gd of c13a39a laid over the clone, both fail (button rects 93×56 and 474×56 in a 90×24 area; 1964-wide buttons in a 1024-wide root) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only test_back.gd and test_system_popup.gd of UICore were run (native headless, `--file`); the whole UICore suite, the browser run and the core tests of the modules that depend on UICore were not run; `ogw review run` runs them
- A button area `Control` that is a `Container` (e.g. `MarginContainer`) resets the row's scale and rect when it sorts its children. Checked with a standalone Godot 4.7.2 headless script that applies the same `_fit_row` logic: the container grows to the row's minimum height (24 → 31), so the buttons stay inside the area rectangle, but the area is larger than the prefab set it. Not written as a finding: the buttons are inside the button area rectangle as the spec states, and the behavior equals the code before this range
- A button area of zero width or height is not fitted (`_fit_row` returns), as the core agent report states; not tested. A rectangle with no size cannot hold buttons under any implementation
- How readable scaled-down labels are was not checked
