# review QACore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/qa_core/dev/qa_core.gd:558 | Spec qa-core.md:42 sets that an input command over its time limit puts in a release for the touches, keys, mouse buttons and gamepad buttons it holds and 0 for the gamepad axes it set that are not 0. The new tests (client/godot/core/qa_core/tests/test_input.gd:553 and :598) only time out `key` (one key) and `drag` (one touch). Nothing tests the mouse button release (`_time_out_input` sets `holds.mouse_position = _input.mouse_position` and `qa_input.gd` `release_events` builds the button release with the mask of the command's own buttons), the gamepad button release, or the axis set to 0 (`holds.axes` from `apply_own`). Nothing tests the `apply_own` rule (client/godot/core/qa_core/dev/qa_input.gd:215) that a `touch_move` of a touch pressed by an earlier `touch_down` is not held by the `touch_move`, so it is not released when the `touch_move` times out. Each can be reached in a test: start `mouse_down`, `pad_button_down`, `pad_axis` or `touch_move`, then call `UnitTestCore.advance_clock` past `QACore.commandTimeoutMs` before the frame that ends the command. If `apply_own` is changed to `apply`, or the axis/mouse branches of `release_events` are dropped, no QACore test fails | Add core tests: a `pad_axis`(left_x, 0.5) and a `mouse_down`(left) over the time limit put in axis 0 and the left button release at the next frame start and fail when that frame ends. A `touch_move`(0) over the time limit after `touch_down`(0) leaves touch 0 pressed | no | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests were not run (no `ogw core test` run in this review; GUT and the generated project files are not in this checkout). The new tests were read, not run. `ogw review run` runs the core tests after each fix
- A frame that takes longer than `QACore.commandTimeoutMs` in real time with a mouse button held by another input command was not checked against InputCore: the release built from the command's own button mask (client/godot/core/qa_core/dev/qa_input.gd:124) leaves that other button out of `button_mask`. No InputCore code that reads `button_mask` was found under `client/godot/core` outside tests, so it was not written as a finding
- A command from the debug screen (not the automation channel) that times out, followed by an automation channel drop before its release frame: `_on_channel_closed` keeps that command's pending releases and also puts the releases of `_input`, so the same release can go in twice in one frame. Not reproduced, low impact, not written
