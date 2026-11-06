## done

- SoundCore (godot): cherry-picked 81a69a48 from `agent/mw55968233873d` onto main 5db3e9c0 as 7eeb5800. It does not change `core-settings.json`, `core-settings.schema.json`, `core-spec/QACore.json` or generated files, so nothing had to be dropped
- `SoundCoreDev.set_dev_mute(bus, mute)` (`client/godot/core/sound_core/dev/sound_core_dev.gd`): sets a separate DEV mute per bus (`SoundCore._dev_mutes`). `_apply_bus` mutes the engine bus when mute, DEV mute or volume 0 is on, so `Sfx` content positional players are also silent. `get_mute` and `LocalDataCore` are unchanged, and `set_mute` and `load_volume_settings` leave it alone. A bus that is not in `SoundBus` gets an error log and nothing changes. It logs an error before `init` and after `release`
- `SoundCoreDev.set_play_skip(skip)`: while it is on, `SoundCore.play` returns `INVALID_HANDLE` after the bus and scope checks pass. It does not load, log or publish an event. Requests made before it turned on play as usual
- `SoundPlayedEvent` is not published when playback starts on a bus whose DEV mute is on (`_start_sfx`). This is decided when playback starts, so it also covers a `play` called before DEV mute turned on that starts after loading
- `_reset_state` turns both states off, so they are off after `release` and after `init`
- Core tests: `client/godot/core/sound_core/tests/test_dev_feedback.gd` covers the two new items of `## test` (DEV mute and play skip). It also tests the event decided at playback start, the non-`SoundBus` bus error, and that `release` turns both states off
- Last runs on 7eeb5800: `ogw core test godot` and `ogw core test godot --web` with SoundCore and every module that `ogw core dependents SoundCore` lists (26 modules), all pass. `ogw code check core` pass (type check, lint, dependency, secret)
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written

## spec proposals

none

## review

none

## unverified

- The first godot and `--web` runs ran at the same time. ChatCore, PushCore, RealtimeCore, ShortcutCore (godot) and GameUpdateCore (`--web`) failed with `test time limit 30000 ms passed` and init-order errors. Those modules do not call the changed code. Run alone, each target passed for all modules, so I took the failures to be slowdown from the two runs at once. I did not reproduce the cause further
- Whether the engine bus is actually silent is checked through `AudioServer.is_bus_mute` and the bus volume, not through audio output
