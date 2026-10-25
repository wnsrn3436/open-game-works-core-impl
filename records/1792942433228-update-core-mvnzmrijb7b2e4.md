# update core: SoundCore (client, Godot)

## done

- `SoundCore` (Godot), `client/godot/core/sound_core/sound_core.gd`
  - `### sound effect`: each `play` on `Sfx` takes a pitch scale 2^(c ÷ 1200) and a variation gain 10^(d ÷ 20) from the `UtilCore` random instance of purpose `sound_variation` (c, d uniform in ±`SoundCore.sfxPitchVariationCents`, ±`SoundCore.sfxVolumeVariationDb`; a setting of 0 takes no draw). They go to `pitch_scale` and `volume_linear` of the sfx player. `Voice` and `Ui` plays set both back to 1 on the shared player
  - End of a play: a play that does not loop ends when its time played outside pause × its pitch scale reaches its sound length. The pitch scale used is the player's `pitch_scale` read back, which is what the engine plays
  - `### voice duck`: an `AudioEffectAmplify` added as the last effect of the `Bgm` bus in `init` and removed in `release`. Its `volume_db` is the duck gain. The gain moves linearly in dB in real elapsed time at `SoundCore.voiceDuckDb` per `SoundCore.voiceDuckAttackMs` going down and per `SoundCore.voiceDuckReleaseMs` going up. It is brought up to date right after every change of "voice playing" (a `Voice` play starts or frees its player, a game time pause or global pause changes) and on each frame. A `Voice` play paused by a pause does not count as playing. `release` takes the effect out and sets the gain back to 0 dB
  - `init` reads the five new keys and fails with an error log when one is missing or out of range
- Core settings: added `SoundCore.sfxPitchVariationCents` 50, `SoundCore.sfxVolumeVariationDb` 1.5, `SoundCore.voiceDuckDb` 9, `SoundCore.voiceDuckAttackMs` 150, `SoundCore.voiceDuckReleaseMs` 500 with `ogw settings set core`. Their properties and `required` entries are in `core-settings.schema.json` (number ≥ 0 for the first three, integer ≥ 1 for the two `Ms` keys, following the spec `meaning`)
- Core tests
  - `tests/test_variation.gd`: 200 `Sfx` plays with 100 cents and 2 dB stay inside 2^(±100÷1200) and 10^(±2÷20) and vary both ways; `Ui` and `Voice` plays on a player a varied `Sfx` play used have pitch scale 1 and gain 1; with both settings 0 every `Sfx` play has 1 and 1; a `Sfx` play with pitch scale below 0.99 whose end the engine does not report is playing at the sound length and 1 ms before length ÷ pitch scale, and has ended at length ÷ pitch scale
  - `tests/test_duck.gd`: with 12 dB, 100 ms, 400 ms: −6 dB at 50 ms, −12 dB at 100 ms and later, still −12 dB while a second voice plays after the first stops, −6 dB 200 ms and 0 dB 400 ms after the last stops; a voice started during the release goes down from where the release got; a game time pause that stops the voice starts the release and the continued voice ducks again; `Sfx` and `Ui` plays do not duck and a `voiceDuckDb` of 0 does nothing; `release` takes the effect off the `Bgm` bus and `init` again starts at 0 dB
  - `tests/support/sound_test_case.gd`: `before_each` sets both variation settings to 0, so the earlier tests that check the end of a `Sfx` play at its sound length keep their exact timing; `duck_db()` reads the duck gain from the last effect of the `Bgm` bus
- Generated files from `ogw core test`: `core-spec/SoundCore.json`, `core-spec/QACore.json` (the harness QACore spec now has the game settings item `uiQuality`; not part of this change, written by `ogw core spec` from the current harness specs), `client/godot/generated/core_settings*.json`, `server/core/testing/dev/setting_types.ts`
- Runs: `ogw core test godot` and `ogw core test godot --web` for SoundCore and every module `ogw core dependents SoundCore` lists: all pass. `ogw code check core`: pass

## spec proposals

none

## review

none

## unverified

- The audible result of the variation and the duck (the mix the engine outputs) was not measured. The tests check the values SoundCore sets on the players and on the `Bgm` effect, which godot.md names as the mapping
