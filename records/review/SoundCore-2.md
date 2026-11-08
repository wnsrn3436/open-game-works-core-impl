# review SoundCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | Commit 55c0a25d sets `SoundCore.busLoudnessLufs.Bgm` back to -20 in settings/core-settings.json:307 and client/godot/generated/core_settings.json:307 (both -20 at 7d72e5fd; no `-28` is left in settings/, client/godot/generated/ or client/godot/core/sound_core/). Its message gives the cause (c8fe1d02 changed the value with no cause or evidence; the harness defines no value for the key) and keeps the earlier default, as the fix direction of R1-1 says. R1-1 is a `spec` finding (commit message without cause and evidence), not a `test evidence` finding, so no defect restore was needed. Client SoundCore only checks that the key exists (client/godot/core/sound_core/sound_core.gd:519-522), so no SoundCore behavior or test depends on the value |

## out of scope

none

## debt

none

## must fix

none

## unknown

- No test was run: the range changes nothing of SoundCore except the core settings value, which SoundCore code only checks for existence. The report of mw7ukr3va3f8f3 records `ogw core test godot` and `--web` passes for SoundCore and its dependents on 55c0a25d; this review did not run them again
- The TimeCore change of the range (279c6798: `set_test_frame_step` renamed to `set_frame_step`, engine fps read removed) is outside the target. SoundCore and its tests were searched and do not call the frame step (`frame_step`, `set_test_frame_step`); SoundCore reads only `TimeCore.get_real_time`, `is_paused` and `make_random_seed`, which that change does not touch
- The other changes of the range (InputCore, QACore tests, contract-tool, server, `records/`) are outside the target and were not reviewed
- Whether -20 is the right BGM loudness target against reference games was not judged; the harness gives no value to compare with
