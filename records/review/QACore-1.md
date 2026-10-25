# review QACore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | settings/core-settings.schema.json:1752 | The spec settings table gives `QACore.captureJpgQuality` the range "10 to 1000" (qa-core.md `## settings`). Under `core` `## core settings`, a range written in `meaning` replaces the default rules and must appear in `core-settings.schema.json` as `minimum`/`maximum`. The schema has `"minimum": 1`, and `_read_settings` uses the same least value (`client/godot/core/qa_core/dev/qa_core.gd:1072`, `_KEY_CAPTURE_JPG_QUALITY: 1`). Reproduction: game settings `core` `{"QACore.captureJpgQuality": 5}` passes the schema check of `ogw game check`, and `QACore.init` returns `true`. `capture_screen jpg` then encodes with quality 0.005, a value outside the spec range. No test checks the lower bound | Set the schema `minimum` to 10 and the least value of `_KEY_CAPTURE_JPG_QUALITY` in `_read_settings` to 10, so that 1 to 9 fail like 1001 does. Add a test in which values 9 and 1001 make `init` fail | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The Godot tests (`ogw core test`) were not run. Test results are judged only by reading the code
- The engine source was not read to check how Godot `Image.save_jpg_to_buffer` turns the float quality into whole percents. The spec states that conversion ("the engine takes whole percents"). This review relies on the spec for it
- Changes in this range to TweenCore, UICore, ScreenEffectCore, UnitTestCore, AuthCore (server) and the review records belong to other targets. Of these, only the operations QACore calls were read: `TweenCore.get_finite_playing_count` and `UICore.is_flow_in_progress`
- The claim that the engine frame order (`SceneTree.process_frame` before the `TimeCore` node `_process`) runs the frame of a device input with the 1 ms budget was checked from the code and from `test_an_input_in_step_mode_runs_its_frame_with_1_ms`. It was not run on a device clock
