# VirtualPadCore review round 5

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R4-1 | fixed | `_apply_state` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:445) now hides only the drawing with `RenderingServer.canvas_item_set_visible` and leaves the element `Control`s visible to the engine GUI, so the mouse and touch focus an element holds is kept while `HIDDEN`. New test `tests/test_ui_below.gd::test_device_change_while_held_keeps_the_pointer_from_the_button_below` (:88) is the reproduction of round 4 with a real `SceneUI` `Button`. Restored in a temporary clone under `worktrees/_core/` (deleted afterwards): line 445 put back to `_pad.visible = _state != VirtualPadState.HIDDEN`, then `ogw core test godot VirtualPadCore --file .../tests/test_ui_below.gd` failed with `[1] expected to equal [0]: the SceneUI button gets no input`. The whole pre-fix `virtual_pad_core.gd` of 95fb207a gave the same failure. On HEAD the module headless pass passed (`VirtualPadCore skipped`, only the render pass not run because the screen is locked) |
| R4-2 | fixed | (a) `test_ui_below.gd::test_keyboard_mouse_click_reaches_the_button_below` (:13) and `::test_touch_under_a_side_popup_reaches_the_button_below` (:25) assert 1 click and no action, the second with a non-modal popup (`test_popup_side.tscn`, (800, 0)-(1300, 400)) away from `fire` and 0 popup inputs. (b) `::test_touch_moved_out_of_a_button_area_does_not_reach_the_button_below` (:39) and `::test_popup_between_press_and_release_keeps_the_pointer_from_the_ui` (:57) assert the action pressed then released, 0 button inputs and 0 clicks. (c) `::test_touch_with_the_gamepad_device_clicks_the_button_below_and_presses_the_action` (:76). (d) `test_state.gd::test_popup_makes_it_inactive` now opens the modal full-screen `test_popup_cover.tscn` and asserts its input count is 0. `VirtualPadTestControl` counts `InputEventMouse` (tests/support/virtual_pad_test_control.gd:9). The button counts `_gui_input` touch and mouse input and its `pressed` signal (tests/support/virtual_pad_test_button.gd:13) |
| R3-1 | fixed | `_on_element_input` (virtual_pad_core.gd:497-509) accepts every touch press on an element while `ACTIVE` and accepts a move or release only when `element.pointer_id` is that pointer; the 32-entry table is gone, so there is no limit on area presses. New test `test_pointer.gd::test_forty_pointers_in_one_button_area_leave_the_joystick_free` (:196) is the spec item at virtual-pad-core.md:218. With the pre-fix `virtual_pad_core.gd` of 95fb207a restored in a temporary clone, that test failed with `[VECTOR2(0, 0)] expected to equal [VECTOR2(0.5, 0.0)]` and `[8] expected to equal [0]: the 40 pointers pressed in the button area give no tap` |

## out of scope

- open-game-works-core/skills/client-core/modules/qa-core.md:135: medium Since this range, a `Hidden` virtual pad is hidden only in the rendering server (client/godot/core/virtual_pad_core/virtual_pad_core.gd:445), so its element `Control`s stay `is_visible_in_tree()`. Engine-visibility users outside the VirtualPadCore definitions now treat elements that are not drawn as visible: `QACore.list_ui` (qa-core.md:135 and :342, mapped to `is_visible_in_tree()` by godot.md:398) lists them with their rects on a desktop run where the pad is `Hidden`, and the `InputBlockCore` pass list (input-block-core.md:106, client/godot/core/input_block_core/input_block_core.gd:485) lets a touch press on a passed element pass the block stage while `Hidden` (before, it was discarded). The definitions do not say whether a `Hidden` element (virtual-pad-core.md:38, "does not draw") counts as visible for these modules. Keeping the element focus that R4-1 needs requires the element `Control`s to stay visible in the tree, so this needs a spec decision (the core agent report of round 4 proposes one for the pass list)

## debt

none

## must fix

none

## unknown

- The render pass did not run: `ogw core test godot VirtualPadCore` reported `render pass not run: the macOS screen is locked or the display sleeps`. So `tests/test_render_state.gd` (the only remaining check that `Hidden` draws nothing, since the `_pad.visible` assertions were removed from `test_state.gd`) was neither run nor checked to fail with drawing left on
- Engine code was not read in the Godot source. I did not check whether Godot resets the rendering-server visibility of the pad canvas item to `is_visible_in_tree()` when an ancestor's visibility changes or the pad re-enters the tree. If it does, a `Hidden` pad would be drawn again after such a change. No core code in client/godot/core changes the visibility of the `VirtualPad` layer or the safe area root, or reparents them (grep of `.visible =`, `set_visible`, `remove_child`), so I found no path that shows this
- Removing the pad focus in `INACTIVE` too (probe: `_pad.visible = _state == VirtualPadState.ACTIVE`) did not fail `test_popup_makes_it_inactive` or `test_popup_between_press_and_release_keeps_the_pointer_from_the_ui`. Opening a popup sets a `ui` block, and InputCore then cancels input and discards the later moves and release of pointers pressed before it. That rule keeps the moves and release away from the popup and the `SceneUI` button, so the spec behavior those tests check holds either way. This is not a test defect
- Only the headless pass of the module and `--file` runs of `test_pointer.gd`, `test_state.gd`, `test_ui_below.gd` were run. `--web`, on-device touch and the dependents QACore and BootstrapCore were not run in this round
