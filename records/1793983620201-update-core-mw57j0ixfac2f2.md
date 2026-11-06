# update core: ScreenEffectCore World skip

## done

- `ScreenEffectCore` (Godot): `ScreenEffectCoreDev.set_world_skip(skipped)` (DEV, logs an error before init and changes nothing). While World skip is on, a `World` `fade`, `flash` or `play_preset` that passes its input check returns a handle settled as `Completed` that never becomes the current `World` handle, so it changes no overlay, starts no tween and publishes no `ScreenEffectStartedEvent`; `skip_to_end` and `clear_handle` of it change no overlay (it holds none), and `wait_result` gives `Completed` at once. A `World` effect that started before the skip goes on; `Cutscene` and `Transition` are not skipped. `release` turns it off (`_reset_state`).
  - `client/godot/core/screen_effect_core/screen_effect_core.gd`, `client/godot/core/screen_effect_core/dev/screen_effect_core_dev.gd`
  - tests: `client/godot/core/screen_effect_core/tests/test_world_skip.gd` (the `## test` item of World skip: World requests settle `Completed` without overlay, `ScreenEffectStartedEvent` or `TweenStartedEvent`; a World fade started before keeps playing to its end while Transition and Cutscene play and publish; an out-of-range opacity is still `Failed` with one error log; after `set_world_skip(false)` a World flash plays and publishes; `release` turns the skip off), and `test_lifecycle.gd` (`set_world_skip` before init logs an error and changes nothing)
- Taken from 92fe5329 (branch `agent/mw5599459c6936`) without its changes of `settings/core-settings.json`, `settings/core-settings.schema.json`, `core-spec/QACore.json`, `server/core/testing/dev/setting_types.ts` and `client/godot/generated/`, which main already has (5db3e9c0). Checked against `skills/client-core/modules/screen-effect-core.md` (harness diff 6564423..f5a4c1c); no change was needed.
- `ogw core test godot` and `ogw core test godot --web` with AccessibilityCore BootstrapCore CutsceneCore QACore SceneCore ScreenEffectCore ShortcutCore TutorialCore UnitTestCore (ScreenEffectCore and its dependents): pass on the committed HEAD. `ogw code check core`: pass
- No engine-specific implementation rules document and no `## <engine> build` of `tools/ogw.md` were written

## spec proposals

none

## review

none

## unverified

- The first native `ogw core test godot` run (job mw57k0t1be56af), started at the same time as the `--web` run, failed in every module: the first test of each module passed its 30000 ms time limit at a setup step (`DataCore.load`), and the failures after it came from modules left uninitialized. The host load average was about 147 then, with other Godot processes running. The `--web` run at the same time passed, and the native rerun (job mw57s7qj4fa88c) on the same commit passed every module without code changes. I did not reproduce the timeout any further; host load is the assumed cause.
