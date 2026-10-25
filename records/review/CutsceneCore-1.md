# review CutsceneCore round 1

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

- The commit range d4e2728..2e6aa2c changes no CutsceneCore file and no CutsceneCore spec. Of the modules CutsceneCore depends on, it changes only ScreenEffectCore (`TimeBasis` input of `fade`, `flash`, `play_preset`, client/godot/core/screen_effect_core/screen_effect_core.gd:87-170, :344-349, :429-438), TweenCore (new `get_finite_playing_count`, client/godot/core/tween_core/tween_core.gd:326-337) and UICore (new `is_flow_in_progress`, client/godot/core/ui_core/ui_core.gd:653-665), with their tests. The other client changes (AuthCore tests, UnitTestCore start signal, generated settings `QACore.captureJpgQuality`, `UnitTestCore.startTimeLimitMs`, `uiQuality.settleLimitMs`) are not called or read by CutsceneCore code. Checked how the changes reach CutsceneCore:
  - ScreenEffectCore: the `ScreenEffect` command calls `ScreenEffectCore.play_preset` without a time basis (client/godot/core/cutscene_core/cutscene_core.gd:1168-1169), so it gets `RealTime`. Before the range `_tween_options` of ScreenEffectCore was a fresh `TweenOptions`, whose `time_basis` default is `REAL_TIME` (client/godot/core/tween_core/tween_options.gd:6), so the playback time basis is unchanged. It matches the CutsceneCore spec, which measures `ScreenEffect` in real elapsed time (skills/client-core/modules/cutscene-core.md:56). The new time basis check in `_check_request` passes for the default value, so the start check order and the `Failed` paths that CutsceneCore relies on (finalize of the previous `ScreenEffect` before `play_preset`) are unchanged. The finalize through `ScreenEffectCore.skip_to_end` (cutscene_core.gd:1267) and `clear_owner` at release (cutscene_core.gd:1946) are not changed by the range
  - TweenCore and UICore: the new operations are only additions; CutsceneCore calls neither, and the `TweenCore.play`, `skip_to_end`, `stop`, `is_playing`, `copy_definition`, `get_preset_kind` and UICore operations it calls are not changed. The new TweenCore failing definition (an easing that is not a member) is in the TweenCore test support only
  - UnitTestCore: the CutsceneCore test case extends `UnitTestCase` (client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd:1) and uses `set_test_settings`, `advance_clock`, `wait_frames`, `check_logs` and `tap`, none of which the range changes. The new `PUT /started` signal is sent by the GUT pre-run hook before the first test, outside the CutsceneCore tests
- The CutsceneCore tests were not run in this review (`ogw core test` needs the GUT setup and the test host). Whether they pass at 2e6aa2c is not checked here
