# review ScreenEffectCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/screen_effect_core/tests/test_playback.gd:119 `test_game_time_preset_holds_during_pause_and_ends_after_the_rest_of_its_duration_in_game_time` calls `play_preset` with `TweenCore.TimeBasis.GAME_TIME` (`Opacity` 0→1 over 1000 ms). It checks that the opacity stays at 0.3 for 1000 ms of real time during `TimeCore.set_paused(true)`, reaches 0.9 after 600 ms more of game time with no result, and ends `Completed` at opacity 1.0. I ran it in a temporary copy of client/godot outside the checkout (GUT, `-gtest=res://core/screen_effect_core/tests/test_playback.gd`): all 10 tests passed on the code as is. With client/godot/core/screen_effect_core/screen_effect_core.gd:169 changed to `_play(channel, handle, definition, TweenCore.TimeBasis.REAL_TIME)`, only this test failed (`paused: opacity at frame 0`: 0.4 expected 0.3, and later frames up to 1.0), and the other 9 passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes only client/godot/core/screen_effect_core/tests/test_playback.gd in ScreenEffectCore. The other changed files (server/core/auth tests, records of other modules) are outside the target and I did not review them.
- My GUT runs used a temporary copy outside the harness (`addons/` and `build/data/` copied from open-game-works-core-impl/client/godot/, no test host), not `ogw core test`. I did not run the web pass.
