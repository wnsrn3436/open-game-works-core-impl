# review UICore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/ui_core/ui_core.gd:2084 | The range added back handling step 1 for a system popup whose open flow is loading its open and close tween presets (`if not _loading_system.is_empty(): return true`, lines 2084-2085). No test sends back input in that state. `test_back_during_a_system_popup_open_flow` (tests/test_back.gd:147) uses `POPUP_TWEEN`, whose preset `load_resources` loads beforehand, so its back input arrives during the open tween and goes through the `_shown_system` OPENING check (ui_core.gd:2086-2088), not through line 2084. The tests that use `POPUP_LATE_TWEEN` as `UICore.systemPopupResource` (tests/test_popup.gd:441,460,477, tests/test_lifecycle.gd:115) never call `_handle_back` or `handle_back_on`. Removing lines 2084-2085 fails no test, although back input in that state then falls through to steps 3-7: with an open popup whose back policy is `Close` it runs `close_popup` on that popup, and with nothing open it opens the exit confirm, against step 1 of `### back input` and the `## test` item "The back handler returns `true` for ... a system popup flow in progress" | Add a test: set `UICore.systemPopupResource` to `POPUP_LATE_TWEEN`, open a popup with back policy `Close`, call `open_system_popup` and, while `is_system_popup_visible()` is still `false`, call `handle_back_on("android")`; assert `true`, that the popup is still open (no `on_closed`) and that no exit confirm opened | no | 85 |
| R1-2 | spec | medium | client/godot/core/ui_core/system_popup_view.gd:76 | The range puts the button row as a child of the `UISystemPopup` button area with `row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)` (lines 76-77), but every button keeps `custom_minimum_size = Vector2(0.0, _BUTTON_HEIGHT)` (line 66, `_BUTTON_HEIGHT` 56) and `SIZE_EXPAND_FILL` with the label text as minimum width. A Godot `Control` is never smaller than `get_combined_minimum_size()`, so the `HBoxContainer` row grows past the anchored rectangle. Run path: a `UICore.systemPopupResource` prefab whose `UISystemPopup.button_area` is a `Control` 40 game units high (or whose width is less than the sum of the label widths of three buttons plus 2 × `_SEPARATION`) → `open_system_popup` with that param → the row and buttons are 56 high (or wider than the area) and extend below (or right of) the button area rectangle. This breaks "The buttons are placed in one row inside the rectangle of the button area ... Buttons are inside the button area and do not overlap" (ui-core.md `### system popup`) and the engine rule "the button row as a child of the button area `Control`, each filling that `Control`" (godot.md `UICore` body area and button area row). The tests only use areas tall enough for 56 (tests/resources/test_system_areas.tscn and test_system_button_area.tscn: anchors 0.6-0.75 of the root) | Size the buttons from the button area instead of a fixed minimum: e.g. no fixed minimum height when the row fills a button area (button height = area height), and let the label shrink or clip (`clip_text`, `text_overrun_behavior`) so the minimum width of the row does not exceed the area; add a test with a button area lower than 56 and with long labels that asserts each button rect is inside the area | no | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- No test was run in this review; the findings come from reading the code and tests of the range. R1-1 was checked by searching every UICore test for back input while `_loading_system` is not empty. R1-2 relies on the Godot rule that a `Control` is not sized below its combined minimum size; no prefab with a small button area was run
- `_show_system_record` (ui_core.gd:1901) inserts a system popup by `open_system_popup` call order. Every system popup uses the same prefab and therefore the same tween preset keys, and `ResourceCore.load` resumes the waiters of one in-flight key in call order, so a later call could not be found that becomes visible first; `test_system_popups_opened_in_one_frame_stack_in_call_order` therefore passes also with plain append. This was not written as a finding because the observable result equals the spec
- The per-frame fit of a body area taken from the root above a `UISystemPopup` button area (`system_popup_view.gd` `_process`) is applied from the first process frame after the popup enters the tree; whether one drawn frame can show the body over the button area before that was not checked
- The whole UICore suite and the core tests of the modules that depend on UICore were not run; `ogw review run` runs them
