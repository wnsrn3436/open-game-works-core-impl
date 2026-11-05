# review ScreenEffectCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/screen_effect_core/screen_effect_core.gd:87 | open-game-works-core/skills/client-core/modules/screen-effect-core.md:106 requires a `Failed` handle and an error log for a destroyed owner. `fade` (:87), `flash` (:118), `play_preset` (:153) and `clear_owner` (:209) still declare `owner: Object`, so the `is_instance_valid(owner)` check in `_check_request` (:439) and in `clear_owner` (:213) is never reached with a freed object. Reproduced on Godot 4.7.2: a script with `static func f(owner: Object)` called with a `Node` freed just before stopped with `SCRIPT ERROR: Invalid type in function 'f' ... argument 1 (previously freed)`; neither the first line of the body nor the caller's next line ran. So `ScreenEffectCore.fade(WORLD, freed_node, ...)` returns no handle, aborts the calling function, and logs no ScreenEffectCore error. client/godot/core/screen_effect_core/tests/test_input_check.gd:32 passes only `null`. | Take the owner as `Variant` at the input boundary of `fade`, `flash`, `play_preset` and `clear_owner` and check it with `is_instance_valid` before use, as `TweenCore.play` does for its target (client/godot/core/tween_core/tween_core.gd:157); add a test that passes a freed owner and checks `Failed`, one error and the current handle kept | no | 95 |
| R1-2 | test evidence | medium | client/godot/core/screen_effect_core/screen_effect_core.gd:350 | open-game-works-core/skills/client-core/modules/screen-effect-core.md:82 requires that when `TweenCore` cannot start playback the new handle ends with `Failed`, the replaced handle with `Cancelled`, and the channel has no effect. No test under client/godot/core/screen_effect_core/tests/ reaches the `not TweenCore.is_playing(tween)` branch of `_play`: no test calls `TweenCore.release` or otherwise makes `TweenCore.play` return the invalid handle (the only `TweenCore.` uses are `init` and the settings key in tests/support/screen_effect_test_case.gd:28,40). Removing lines 351-353 would fail no test. | While a fade plays on a channel, call `TweenCore.release`, request a new non-zero fade on the same channel, and check the new handle is `Failed`, the earlier handle is `Cancelled`, and `get_overlay_state` is black, opacity 0, hidden | no | 90 |
| R1-3 | test evidence | medium | client/godot/core/screen_effect_core/screen_effect_core.gd:135 | open-game-works-core/skills/client-core/modules/screen-effect-core.md:79 applies to every request type, and :132 lists duration 0 among the cases where `wait_result` settles once. The only `flash` with rise, hold and fall all 0 is client/godot/core/screen_effect_core/tests/test_lifecycle.gd:43, called before `init`, where it fails in `_check_request` and never reaches line 135. Other zero-duration tests use `fade` or `play_preset` (test_input_check.gd:61-62, test_playback.gd:144); test_playback.gd:216 uses hold 100. Removing the `_publish_started` or `_finish(COMPLETED)` call of this branch would fail no test. | On an initialized module, call `flash` with rise, hold and fall 0 and check `Completed` when the operation returns, overlay opacity 0, and one `ScreenEffectStartedEvent` of that channel | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The owner parameters at client/godot/core/screen_effect_core/screen_effect_core.gd:87, :118, :153, :209 are still `Object`; a freed object still stops the call before the body on Godot 4.7.2 (reproduced); no freed-owner test exists |
| D2 | open | R1-2 | No test makes `TweenCore.play` fail; the failure branch at client/godot/core/screen_effect_core/screen_effect_core.gd:350 is unchanged and untested |
| D3 | open | R1-3 | The only all-zero `flash` call is still before `init` (client/godot/core/screen_effect_core/tests/test_lifecycle.gd:43) |

## must fix

none

## unknown

- The commit range is empty (ab75c82..ab75c82), so only the positions of input `## debt` items were checked, plus a read of client/godot/core/screen_effect_core/screen_effect_core.gd against the spec; screen_effect_core_node.gd, screen_effect_handle.gd, screen_effect_waiter.gd, dev/ and events/ were not read
- The core tests of ScreenEffectCore were not run; the R1-1 reproduction used a one-file Godot 4.7.2 script outside the checkout, not the module code
