# SoundCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | settings/core-settings.json:307 | Commit c8fe1d02 (same change also in 0d4c6278) changes the core settings default `SoundCore.busLoudnessLufs.Bgm` from -20 to -28 (also client/godot/generated/core_settings.json:307). The message says only "SoundCore Bgm -28 LUFS" inside "settings of the spec changes since harness 3417ebc", and the body is empty. The harness at HEAD defines no default for `SoundCore.busLoudnessLufs` (skills/client-core/modules/sound-core.md:177 and skills/resource/production.md:183 name the key with no value). `git log 3417ebc..HEAD` of the harness has no commit about BGM loudness, and the core-impl records/ have no -28 value either. So the message gives no cause the value fixes and no evidence (measurement, reproduced failure, specification), which `## harness writing rules` of AGENTS.md requires for a changed threshold. The value is what `ogw resource finalize` brings every BGM file to, so it makes BGM 8 dB quieter in every game that does not override it | Give the cause and the evidence for -28 in a commit message (e.g. the judge or play result that found BGM too loud, or a loudness measurement against reference games). Without evidence, restore -20 | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- `reset_volume_settings` on a device file that is not loaded: only read in code (it calls `LocalDataCore.remove_value`, and `LocalDataCore` logs one error per file kind), not run
- The seed change was checked only with the test clock and a random base (`test_variant_and_variation_randoms_are_seeded_by_time_core_make_random_seed`). The path without a random base (device time) was checked by reading `TimeCore.make_random_seed` (client/godot/core/time_core/time_core.gd:392), not run from SoundCore
- Tests run: `ogw core test godot SoundCore --file` for tests/test_volume.gd and tests/test_variation.gd, both pass. The other SoundCore test files and the whole suite were not run, because the range changed nothing they cover except the two `TimeCore.make_random_seed` calls in `init`, which every SoundCore test runs through `start_modules`
- The other commits of the range (server core, other client modules, generated contract) are outside this target and were not reviewed
