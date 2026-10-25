# update core: ScreenEffectCore (client, Godot)

This job repeats job mvodg63i858ddc on the current main (f11d970), which now has `QACore.captureJpgQuality`.

## done

- Cherry-picked 7ba885f from `agent/mvodg63i858ddc` as 3524ed0. Its only conflict was `client/godot/generated/core_settings.json`: 7ba885f held the temporary value `"QACore.captureJpgQuality": 900` and main holds `850` from `core-settings.json` (ef028d2, 7bdaae2). I kept main's file, so the commit does not touch that file. The other generated files with the temporary key (`core-spec/QACore.json`, `client/godot/generated/core_settings_types.json`, `server/core/testing/dev/setting_types.ts`) were already the same as main and merged with no change
- Skipped b9de0c3. It only removed the temporary QACore key from the generated core settings. Main has that key for real, so applying it would have removed a real key
- `ScreenEffectCore` (Godot), `client/godot/core/screen_effect_core/screen_effect_core.gd`
  - `fade`, `flash` and `play_preset` take an optional last argument `time_basis: TweenCore.TimeBasis`, default `TweenCore.TimeBasis.REAL_TIME`. `_play` puts it into the `TweenOptions` given to `TweenCore.play`, so playback follows that time basis (`### playback`)
  - `_check_request` checks the channel, then the time basis (`0 <= time_basis < TweenCore.TimeBasis.size()`). If either check fails, the call logs one error and returns a handle settled as `Failed`. It returns before `_make_current`, so no channel's effect changes and no `ScreenEffectStartedEvent` is sent (`## error`, spec debt D1)
- Core tests
  - `tests/test_input_check.gd` `test_channel_or_time_basis_not_a_member_fails_and_keeps_the_effect_of_every_channel`: covers the new `## error` row and D1. It uses channels -1 and 3, and time bases -1 and 7, on `fade`, `flash` and `play_preset`
  - `tests/test_playback.gd` `test_game_time_fade_holds_during_pause_and_ends_after_the_rest_of_its_duration_in_game_time`
  - `tests/test_playback.gd` `test_game_time_flash_in_step_mode_changes_opacity_only_in_the_frames_of_a_step`
- `core-spec/` from `ogw core spec` with the current harness specs, in the same commit: `ScreenEffectCore.json` (one more input for each of the three operations), plus `TweenCore.json` (`get_finite_playing_count`) and `UICore.json` (`is_flow_in_progress`), which the current harness specs have and main's `core-spec/` did not. The `ogw core test` runs of this job made no further change to `core-spec/`
- Last `ogw core test`, on 3524ed0, with the edited module and every module listed by `ogw core dependents ScreenEffectCore` (`AccessibilityCore BootstrapCore CutsceneCore QACore SceneCore ScreenEffectCore ShortcutCore TutorialCore UnitTestCore`):
  - `ogw core test godot ...` (job mvoe63ryca93b1): all pass
  - `ogw core test godot ... --web` (job mvoe64vt521cd3): all pass
- `ogw code check core` (job mvoe8zzg4e8a8f): type check, lint, dependency and secret all pass

## spec proposals

none

## review

none

## unverified

- The mutation check (both new playback tests fail when the time basis is not passed to `TweenCore`) was done by job mvodg63i858ddc. I did not run it again in this job, because the cherry-picked implementation and tests have the same content
- Two earlier `ogw core test` jobs (mvoe59lbf33339, mvoe59zpdf5548) ran no tests. My shell passed all the module names as one argument, so they stopped with `not a module of godot`. The jobs above, which pass, replace them
