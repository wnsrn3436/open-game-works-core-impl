# review fix QACore round 1

## done

- QACore (Godot): core tests only, no implementation change
  - `client/godot/core/qa_core/tests/test_input.gd:599` `test_mouse_and_gamepad_inputs_over_the_time_limit_are_let_go`: `mouse_down`(left), `pad_button_down`(a) and `pad_axis`(left_x, 0.5) each go over `QACore.commandTimeoutMs` in the frame their input goes in. Each one fails with "the command went over its time limit" and one warn. Its release (`mouse_up` of button 1, `pad_up` of button A, axis left_x at 0) goes in at the next frame start, in the frame whose end fails the command, and it puts in no other device input. After that the held inputs are empty, the `left_x+` action strength is 0, and the mouse button and gamepad button can be pressed again
  - `client/godot/core/qa_core/tests/test_input.gd:641` `test_a_touch_move_over_the_time_limit_leaves_the_touch_pressed`: after `touch_down`(0), a `touch_move`(0) over the time limit puts in its move and no release, and touch 0 stays pressed, so `touch_up`(0) still works
  - `client/godot/core/qa_core/tests/test_input.gd:660` helper `start_over_time_limit`: moves the test clock past the time limit in `frame_started` of the frame where the command's inputs go in (once `holds` is set), so the time limit check of that frame runs before the frame end that would end the command
  - `client/godot/core/qa_core/tests/support/qa_input_probe.gd`: records `pad_down`/`pad_up` (gamepad button index) and `axis` (`<axis>=<value with two decimals>`), and adds `frames_of_input` to match exact `<kind>:<detail>` records
- Mutation check: I changed `apply_own` to `apply` in `QACore._on_frame_start` and removed the axis branch of `release_events`, and both new tests failed. In a separate run I removed the mouse button and gamepad button release branches of `release_events`, and the mouse/gamepad test failed. I reverted both changes, so they are not in the commit
- `ogw core test godot BootstrapCore QACore UnitTestCore` (QACore and its dependents): 337/337 tests passed. The exit code was 1 only because the screen was locked, so QACore's render pass was skipped
- `ogw core test godot BootstrapCore QACore UnitTestCore --web`: 337/337 passed, exit 0
- `ogw code check core`: type check, lint, dependency and secret all pass
- Engine-specific implementation rules documents: none. `## <engine> build` of `tools/ogw.md`: not written

## spec proposals

none

## review

- R1-1: fixed. Tests added at `client/godot/core/qa_core/tests/test_input.gd:599` (mouse button release, gamepad button release, axis set to 0 at the time limit) and `client/godot/core/qa_core/tests/test_input.gd:641` (`apply_own` rule: a `touch_move` holds no touch), using `client/godot/core/qa_core/tests/support/qa_input_probe.gd`, which now records gamepad buttons and axes

## unverified

- QACore's render pass did not run on the native Godot target because the macOS screen was locked. Its headless pass and the `--web` run passed. The changed files are tests only and do not touch the render pass
