# review SoundCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/sound_core/tests/test_dev_feedback.gd:91 | `## DEV` play skip of the spec skips only a `play` "whose bus and resource scope pass the checks of `## error`", so a `play` with a missing or released scope while play skip is on must still return the invalid handle with an error log. `test_play_skip_returns_the_invalid_handle_without_load_log_or_event_and_keeps_earlier_plays` checks the bus check order (`errors() == 1` for `SoundBus.BGM`) but never calls `play` with a null or released scope while play skip is on, and no other test does (`set_play_skip` is called only in this file; `qa_core/tests/test_feedback_switch.gd:91` passes the global scope). Moving `if _play_skip: return INVALID_HANDLE` of `client/godot/core/sound_core/sound_core.gd:372` above the scope check at `sound_core.gd:369` makes `play(key, SFX, released_scope)` return without the error log, and every test still passes | Add to the play skip test a `play` with `null` and with a released scope while play skip is on, asserting the invalid handle and one error log each | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Core tests were not run in this review; the finding R1-1 was checked by reading every caller of `set_play_skip` in `client/` and `benchmark/` and every test that drives it
- Whether a bus with DEV mute is actually silent at the audio output was not checked; the implementation and the tests rely on `AudioServer.set_bus_mute` / `AudioServer.is_bus_mute`
- `QACore` code that calls `set_dev_mute` and `set_play_skip` (`client/godot/core/qa_core/dev/qa_core.gd:1261`) is outside this target and was read only to find callers
