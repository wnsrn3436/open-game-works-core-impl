# VirtualPadCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | client/godot/core/virtual_pad_core/tests/test_pointer.gd:102 | `test_outside_pointer_after_a_popup_is_unconsumed` is meant to cover the `_area_pointers` clear in `_set_state` when it leaves `ACTIVE` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:439), but it never depends on that clear. `open_popup` starts the popup's input block, so `InputCore` makes an input cancel, and `_check_cancel` (virtual_pad_core.gd:485) clears `_area_pointers` first. A probe test in a temporary copy confirmed this: `InputCore.get_cancel_count()` goes up across `open_popup()`. With line 439 deleted in the copy, the whole VirtualPadCore suite passed (`ogw core test godot VirtualPadCore`, headless). The clear is still needed: in the same copy, a test that first makes a `content` block with the joystick in its pass list and then runs press in the joystick area, `open_popup()` (cancel count unchanged, asserted), release, `UICore.close_all_popups()`, unblock, press pointer 0 at OUTSIDE, drag below it, drag into the joystick area failed with `[1] expected to equal [2]`. The stale pointer ID makes the joystick consume the outside pointer's move. The same test passed at HEAD | Make the popup test reach `INACTIVE` without an input cancel (e.g. open the popup under a block that was already active) and assert that the cancel count did not change, so the test fails when the `_set_state` clear is removed | no | 90 |
| R2-2 | test evidence | medium | client/godot/core/virtual_pad_core/virtual_pad_core.gd:392 | No test covers the `_area_pointers.fill(-1)` in `_close`. With that line deleted in a temporary copy, the whole VirtualPadCore suite passed. Its effect is real: in that copy, `touch(0, true, center_of(FIRE))`, `VirtualPadCore.close_layout()`, `touch(0, false, <same point>)` (the element is gone, so no element gets the release), `open(LAYOUT_FIXED)` again, `touch(0, true, OUTSIDE)`, `drag(0, OUTSIDE + (0, 100))`, `drag(0, center_of(FIRE))` left `recorder.drags` unchanged (`[1] expected to equal [2]`). The outside pointer was consumed, which is the D1 defect. The same test passed at HEAD. Scope release reaches `_close` through `_on_scope_released` (:413) and is also untested for this | Add a test to test_pointer.gd for an outside pointer whose ID was held in an area when the layout closed (by `close_layout` and by scope release), asserting a `DragEvent` per move over an element | no | 90 |
| R2-3 | spec | medium | client/godot/core/virtual_pad_core/virtual_pad_core.gd:529 | `_add_area_pointer` appends to `_area_pointers`, which is an empty `PackedInt64Array` after `init` (`_reset_state`, :875) and is never sized beforehand. So the first area press after `init`, and every press that brings more area pointers down at once than before, allocates inside `_on_element_input` before `_press` calls `InputCore.inject_action`. open-game-works-core/skills/client-core/modules/virtual-pad-core.md `### lifecycle` says "From receiving a pointer to calling `InputCore.inject_action`, no memory is allocated". Reproduced in a temporary copy: after `open(LAYOUT_FIXED)`, `_area_pointers.size()` is 0, then 1 after `touch(0, true, center_of(FIRE))`, then 2 after `touch(1, true, stick_point(0, 0))`. client/godot/core/virtual_pad_core/tests/test_memory.gd:32 runs 100 warm-up cycles before it measures, so it does not see this growth | Size `_area_pointers` once outside the pointer path (e.g. in `init`, to a fixed capacity filled with -1) and decide what happens to a press when the capacity is full. Make test_memory.gd measure the first area press after `open_layout` for this array | no | 80 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Since commit 1ed504e, elements are `MOUSE_FILTER_PASS` while `ACTIVE` (virtual_pad_core.gd:450). `_on_element_input` (:494) accepts a drag or release only for IDs in `_area_pointers`, so the move of a pointer pressed outside goes on to `InputCore._on_unhandled_input`. The new tests in test_pointer.gd:70, :88 and :102 pass at HEAD. With `MOUSE_FILTER_STOP` put back in a temporary copy, all three fail: :70 with `[1] expected to equal [2]` (the round 1 failure), `[1] expected to equal [3]` and `[2] expected to equal [4]`; :88 and :102 with `[0] expected to equal [1]`. A probe test with an `_unhandled_input` counter node confirmed both sides. An outside pointer's press, move over FIRE and release over FIRE all reach the world stage (3 events). An area pointer's moves and release reach none (0 events) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | This is the same defect as R1-1. At HEAD, test_pointer.gd:70 (pointer pressed outside, moved over FIRE and the joystick, released over the joystick) passes, with one `DragEvent` per move and the release, and no action pressed. It fails when `MOUSE_FILTER_STOP` is restored |

## must fix

none

## unknown

- Only the headless pass was run (`ogw core test godot VirtualPadCore`, whole module, in temporary copies at HEAD and with each defect restored). The `--web` and render passes and an on-device touch run were not done
- Godot 4.7.2 engine source was not read. The routing (touch focus, `MOUSE_FILTER_PASS` bubbling, drag without touch focus going to the control under it) was observed only through test runs
- Engine mouse input emulated from touch is still accepted by every element while `ACTIVE` (virtual_pad_core.gd:520), including the emulated motion of a pointer pressed outside. This was the same before the range under `MOUSE_FILTER_STOP`, and `InputCore._on_emulated_mouse` does not use emulated mouse input at the world stage. Whether a game node outside core reads emulated mouse motion was not checked
- A release that never reaches its element while the state stays `ACTIVE` (e.g. the element cannot process during a scene tree pause) would leave a stale entry in `_area_pointers`. Pause handling was not tested
- The QACore and BootstrapCore dependents were not run. `ogw review run` runs the dependents' core tests after each fix
