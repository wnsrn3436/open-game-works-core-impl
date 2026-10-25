# SceneCore review round 1

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

- The commit range d4e2728f..13408e4f changes no file under `client/godot/core/scene_core/`, and `## spec changes` is `none`. The changes in that range that SceneCore code or its tests reach were checked: `client/godot/core/screen_effect_core/screen_effect_core.gd`, `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/tween_core/tween_core.gd`, `client/godot/core/unit_test_core/dev/unit_test_core.gd`, `client/godot/core/unit_test_core/dev/gut_pre_run.gd`, `client/godot/generated/core_settings.json` and `settings/core-settings.json`. None of them changes a SceneCore setting, a call that SceneCore makes, or a behavior that SceneCore relies on:
  - ScreenEffectCore: `fade`, `flash` and `play_preset` take a new optional `TimeBasis` that defaults to `RealTime`. SceneCore itself calls only `ScreenEffectCore.is_initialized` and `ScreenEffectCore.clear_owner` (`client/godot/core/scene_core/scene_core.gd:604`), and `clear_owner` (`client/godot/core/screen_effect_core/screen_effect_core.gd:209`) is unchanged. The test stub `client/godot/core/scene_core/tests/support/loading_screen_stub.gd:38` calls `fade` with six arguments, so it takes the default `RealTime`; the previous behavior was the same, since `TweenOptions.time_basis` defaults to `RealTime` (`client/godot/core/tween_core/tween_options.gd:6`) and `_tween_options` was not set otherwise before this range
  - UICore: only the new query `is_flow_in_progress` was added; its caller in `open-game-works-core/skills/client-core/modules/ui-core.md:50` is `QACore`, and SceneCore does not call it. `open_root_panel`, `reset_panel_stack`, `set_panel_lock`, `close_all_popups`, `open_system_popup`, `get_layer` and `get_block_pass_list`, which SceneCore calls, are unchanged
  - TweenCore: only the new query `get_finite_playing_count` was added; SceneCore does not call TweenCore
  - UnitTestCore: the run now sends `PUT /started` before the first test setup. The SceneCore tests use only `wait_frames`, `advance_clock`, `set_test_settings` and `check_logs`, which are unchanged
  - Settings: the new keys `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` and the `uiQuality.settleMs` → `uiQuality.settleLimitMs` change are not read by SceneCore code or its tests
- The tests were not run (no Godot run in this review). The judgement above is from reading code
- SceneCore code outside the range was read only to see what the changed modules reach; it was not reviewed item by item against every `## test` item of the spec, since problems that existed before the range and are unrelated to its changes are not in scope of this round
