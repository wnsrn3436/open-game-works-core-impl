# review QualityCore round 1

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

- The commit range 85f6b36d..3c2809f9 changes no file under `client/godot/core/quality_core/` and no `QualityCore.*` key of `settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings.json` or `client/godot/generated/core_settings_types.json`. The review covered the dependency changes that QualityCore reaches: `client/godot/core/time_core/time_core.gd` (frame step, random seed), `client/godot/core/time_core/dev/time_core_dev.gd`, `client/godot/core/log_core/log_core.gd` (comments only) and the `QualityCore.get_level` caller `client/godot/core/qa_core/dev/qa_query.gd` (`quality_level_name`, unchanged code next to the changed lines)
- TimeCore frame step and the auto downgrade: `QualityCore._on_frame` (client/godot/core/quality_core/quality_core.gd:485) measures `TimeCore.get_real_frame_ms`, which at a frame step of fps f is ⌊n × 1000 ÷ f⌋ − ⌊(n − 1) × 1000 ÷ f⌋. n frames then sum to at most n × 1000 ÷ f ms, so the average FPS is at least f. The runner records at game settings `targetFps` (tools/ogw.md:387), and base FPS is at most `frame_limit_fps` ≤ `targetFps`, so the recorded run never meets the downgrade condition; checked by calculation, not by a test run at a frame step
- The TimeCore frame step differences from time-core.md (frame step turned on from `--fixed-fps` or the Movie Maker fps without `set_frame_step`, and the DEV operation named `set_test_frame_step`) are already items D1, D2 and D3 of `records/review-debt/TimeCore.json`, so they are not written again here
- `ogw core test godot QualityCore` passed on this checkout (job mw7u00zfb4fae3). The web runtime (`--web`) was not run
- Engine behavior on hardware (actual shadow filter, render scale and `Engine.max_fps` effect on drawing, `OS.get_memory_info` and `DisplayServer.screen_get_refresh_rate` on each platform) was not checked: the core tests run headless
