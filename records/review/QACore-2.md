# review QACore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/qa_core/tests/test_input.gd:599` times out `mouse_down`(left), `pad_button_down`(a) and `pad_axis`(left_x, 0.5) in the frame their input goes in (`start_over_time_limit` at :660 moves the test clock in `frame_started` once `holds` is set, so `_check_time_limits` in `client/godot/core/qa_core/dev/qa_core.gd:543` runs before the `frame_ended` that `_end_after_input` waits for) and asserts the `mouse_up:1`, `pad_up:0` and `axis:0=0.00` records land in the frame whose end fails the command, that no other device input goes in, the held inputs are empty and the `left_x+` strength is 0. Dropping the mouse, gamepad button or axis branch of `release_events` (`client/godot/core/qa_core/dev/qa_input.gd:153`) leaves that record missing, so the `frames_of_input` assert fails. `client/godot/core/qa_core/tests/test_input.gd:641` times out a `touch_move`(0) after `touch_down`(0) and asserts no `touch_up` and touch 0 still held; with `apply` in place of `apply_own` (`client/godot/core/qa_core/dev/qa_core.gd:621`) the drag puts touch 0 in `holds` (`qa_input.gd:181`), `release_events` releases it, and the `count_of("touch_up")` = 0 assert fails. `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_input.gd` passed in this checkout |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The mutations named in `## previous` were traced through the code, not run: R1-1 is a `spec` finding, and the core agent report states it ran them. Only the unmutated `test_input.gd` run was done in this review
- The rest of the commit range (NativeUiCore, auth, guild, storage, records) is outside the target and was not read
- The two unknown items of round 1 (button mask of a release while another command holds a mouse button; a debug screen command that times out before an automation channel drop) were not rechecked: the range changed no QACore implementation code
