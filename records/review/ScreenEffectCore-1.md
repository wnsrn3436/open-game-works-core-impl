# review ScreenEffectCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/screen_effect_core/screen_effect_core.gd:169 | The spec (skills/client-core/modules/screen-effect-core.md:29, :78) gives `play_preset` an optional `TimeBasis` input, and playback runs on the `TimeBasis` of the request. No test checks that `play_preset` plays on the time basis it receives. In client/godot/core/screen_effect_core/tests/, `GAME_TIME` is passed only to `fade` (test_playback.gd:40, test_input_check.gd:92) and `flash` (test_playback.gd:67). `play_preset` only gets the default or the out-of-range bases (test_input_check.gd:91, :98). If line 169 is changed to `_play(channel, handle, definition, TweenCore.TimeBasis.REAL_TIME)`, every ScreenEffectCore test still passes. A `GameTime` preset would then keep playing during a game time pause | Add a core test: a `play_preset` with `TweenCore.TimeBasis.GAME_TIME` (for example an `Opacity` 0→1 over 1000 ms) keeps its opacity during `TimeCore.set_paused`(true) while real time passes, then completes after the rest of its duration in game time | no | 88 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the core tests (GUT) in this review. R1-1 comes from reading the code and searching every call in the module's tests that passes a time basis.
- I did not check TweenCore's own `GameTime` and step-mode behavior, which the new tests rely on (`TweenCore.play` reads `TweenOptions.time_basis` when called, client/godot/core/tween_core/tween_core.gd:459). TweenCore is not the target.
