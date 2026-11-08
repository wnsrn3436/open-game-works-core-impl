# ResolutionCore review round 1

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

- Commit range 85f6b36d..67565190 changes no file under `client/godot/core/resolution_core/`. It changes none of the modules ResolutionCore depends on (`LogCore` changes only comments, `log_core.gd:270`, `:350`, `:359`; `EventCore`, `LocalDataCore`, `ResourceCore` are unchanged) and none of the ResolutionCore settings keys (`baseResolution`, `maxResolution`, `ResolutionCore.fillColor`, `ResolutionCore.fillImage` in `settings/core-settings.json`, `client/godot/generated/core_settings.json`, `client/godot/generated/core_settings_types.json`). The changed callers in the range (`client/godot/core/qa_core/dev/qa_query.gd` `frame_step_fps` next to `get_window_size`, and `font_weight` next to `_font_size`, which calls `game_to_window`) add no new call of a ResolutionCore operation and pass no new input to one. So no change in the range causes or reveals a ResolutionCore problem.
- For `## out of scope`, these were read against the spec: `client/godot/core/resolution_core/resolution_core.gd`, `resolution_core_node.gd`, `dev/resolution_core_dev.gd`, and the test file names and the bodies of `tests/test_game_area.gd`, `tests/test_fill.gd` and `tests/support/resolution_test_support.gd`. Each item of spec `## test` has a test. The bodies of `tests/test_screen_mode.gd`, `tests/test_lifecycle.gd`, `tests/test_window_size.gd`, `tests/test_event.gd`, `tests/test_render_screen_mode.gd` and `tests/test_memory.gd` were not read; only their test names were.
- The core tests were not run in this review (`ogw core test` for ResolutionCore). The render tests (`tests/test_render_screen_mode.gd`) need a desktop that can draw, and the macOS full-screen transition end (`titlebar_changed` then `window_can_draw`) needs a real macOS window. Neither was checked here.
- How the callers convert test-window pixels (spec `## DEV`: InputCore `_real_to_window_scale`, `input_core.gd:893`, and InputBlockCore, `input_block_core.gd:464`) belongs to those modules and was not reviewed.
