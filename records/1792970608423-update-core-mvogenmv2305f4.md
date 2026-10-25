# update core: QACore (client, Godot)

## done

- `QACore` (Godot), `client/godot/core/qa_core/`
  - `capture_screen` takes an optional format (`png`, `jpg`; `png` when left out). `jpg` is `Image.save_jpg_to_buffer(QACore.captureJpgQuality ÷ 1000)`, `png` is `Image.save_png_to_buffer()`. Another format fails before the headless check, with no capture (`dev/qa_builtins.gd` `_capture_format`, `dev/qa_core.gd` `_capture_image`)
  - `capture_video` takes the same optional second argument and sends frames of that format. The format check comes after the ms check and before the headless and channel checks
  - `list_commands` `args`: `capture_screen` is `["format"]`, `capture_video` is `["ms", "format"]`
  - `init` reads `QACore.captureJpgQuality` (1 to 1000; a missing or out-of-range value fails `init` with an error log, the same as the other integer settings)
  - QAState `ui_flow` (`UICore.is_flow_in_progress`, `false` without `UICore`) and `finite_tweens` (`TweenCore.get_finite_playing_count`, 0 without `TweenCore`), after `in_transition` (`dev/qa_query.gd`)
  - Step mode input budget: right before each device input of an input command goes in at the frame start (`_on_frame_start`, frame code), when step mode is on, the budget is 0, `TimeCore.is_paused` is `false` and the client is not in `Playing` of a lockstep match, QACore calls `TimeCoreDev.add_step_budget(1)` and marks the command (`_add_input_budget`). When a marked command ends (`_finish`, before its response) with budget left, QACore sets it to 0 with `TimeCore.set_step_mode(true)` through `_set_step_mode` (`_clear_input_budget`). Unmarked commands leave the budget alone. The releases a channel disconnect puts in belong to no command and add no budget. The lockstep check is shared with `step` (`_in_lockstep_play`)
- Core tests
  - `test_render_capture.gd::test_capture_formats`: `jpg` gives bytes starting `FF D8` that load as a JPEG of `ResolutionCore.get_window_size`; `png` and no argument give PNG bytes of the window size; `gif` fails with one warn log; quality 10 gives fewer bytes than quality 1000
  - `test_render_capture.gd::test_capture_video_of_jpeg_frames`: `capture_video`(500, `jpg`) over the automation channel sends ⌊500 × 4 ÷ 1000⌋ JPEG frames of the window size
  - `test_state.gd::test_ui_flow_and_finite_tweens_during_a_popup_open_tween`: during the open tween of a popup (new test resources `qa_test_popup_tween.tscn`, `qa_tween.tres`), `ui_flow` is `true` and `finite_tweens` is 1 or more. After the open flow ends they are `false` and 0
  - `test_input.gd::test_an_input_in_step_mode_runs_its_frame_with_1_ms`: in step mode with budget 0, `key Space` makes `InputCore.is_just_pressed(cutscene_advance)` `true` in the `_process` of a `PROCESS_MODE_PAUSABLE` node, in the press frame; game time grows by 2; the budget is 1 in the frame of each device input. With `TimeCore.set_paused(true)` and with step mode off, no budget is added and `TimeCore` logs no error
  - `test_input.gd::test_an_input_in_step_mode_clears_the_budget_it_left`: at time scale 1 the 1 ms is left at the end of `key`, and the command sets it to 0 (step mode stays on, the engine stops again, `step_budget_ms` 0). A budget of 5 that was there before `key` is not added to and not reset
  - `test_realtime.gd::test_an_input_in_a_lockstep_match_adds_no_step_budget`: in `Playing` of a lockstep match in step mode, `key` adds no budget and game time does not grow
  - `test_commands.gd`: `BUILTIN_ARGS` has the new `args`; the invalid argument test has `capture_video 1000 gif` and `capture_screen gif`
  - `test_setup.gd::test_screen_commands_of_a_headless_run`: `capture_screen jpg` fails in a headless run
  - I checked that the new tests catch a missing implementation: with `_add_input_budget` turned off, both new `test_input.gd` tests fail; without the lockstep check, the lockstep test fails on game time (2, expected 0). I restored the code both times
- Last `ogw core test`: `godot QACore BootstrapCore UnitTestCore` and the same with `--web`; all pass. `ogw code check core`: type check, lint, dependency and secret all pass

## spec proposals

- `QACore.captureJpgQuality` is "1 to 1000" in `skills/client-core/modules/qa-core.md` `## settings`, and `skills/client-core/engines/godot.md` maps it to `Image.save_jpg_to_buffer(QACore.captureJpgQuality ÷ 1000)`. Godot 4.7.2 takes the JPEG quality as a whole percent: with 1 (0.001) the engine logs `ERROR: Couldn't set jpg quality` and returns an empty buffer, so `capture_screen jpg` fails with `could not read the screen` (I reproduced this in the render pass of `test_capture_formats` with quality 1). Values from 1 to 9 always fail this way, and values that are not multiples of 10 are cut down to a whole percent. Proposal: make the range 10 to 1000 in the spec (the schema `minimum` of `core-settings.schema.json` changes with it), or add a rule to the godot.md row for values below 10 (e.g. use quality 0.01). The implementation follows the spec as written: values 1–9 pass `init`, and their captures fail

## review

none

## unverified

- The spec's "advanced ms counts that 1 ms" is not tested directly. Telemetry already measures advanced ms from `TimeCore` game time while step mode is on (`qa_telemetry.gd` `fold`), so the 1 ms enters it through game time. No telemetry assertion checks it
- In core tests, `TimeCore` runs on the test clock, and moving that clock uses the step budget at once (`TimeCoreDev.step_test_frame`). So the step mode input tests move the clock from an `ALWAYS` node with process priority 1000000 at the end of each frame (`ClockDriver`, `test_input.gd`). With the device clock, `TimeCore` uses the budget in its own `_process` and defers the engine pause to after the frame (TimeCore's existing behavior). That path was not run here
