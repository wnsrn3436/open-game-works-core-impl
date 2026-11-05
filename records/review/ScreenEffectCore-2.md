# review ScreenEffectCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `fade`, `flash`, `play_preset` and `clear_owner` take the owner as `Variant` (client/godot/core/screen_effect_core/screen_effect_core.gd:88, :121, :158, :217) and turn it into an `Object` with `_object_of` (:507), which returns `null` for a non-object or a freed object; `_check_request` (:449) logs one error and fails on `null`, before `_new_handle` and `_make_current`, so the current handle is kept. Test client/godot/core/screen_effect_core/tests/test_input_check.gd:120 passes a freed `Node` to `fade` (duration 100 and 0), `flash`, `play_preset` and `clear_owner`, and checks 4 errors, `Failed` for each, no `ScreenEffectStartedEvent`, the overlay unchanged and the current fade completing. Restored in a temporary clone of this checkout at f9a6f63 by changing the four `owner: Variant` parameters back to `owner: Object`: `ogw core test godot ScreenEffectCore` failed `test_destroyed_owner_fails_and_keeps_the_current_handle` with `SCRIPT ERROR: Invalid type in function 'fade' ... argument 2 (previously freed)`; on the unmodified checkout the module passes |
| R1-2 | fixed | Test client/godot/core/screen_effect_core/tests/test_playback.gd:245 calls `TweenCore.release` while a fade plays and requests a new fade on the same channel, then checks the new handle `Failed`, the replaced handle `Cancelled`, no event, and the overlay black, opacity 0, hidden at once and 2 frames later. Restored in the temporary clone by deleting the `if not TweenCore.is_playing(tween):` block of `_play` (screen_effect_core.gd:359-363): that test failed (`the handle has no result yet`, results `[1]` instead of `[1, 2]`, one started event, overlay blue and visible) |
| R1-3 | fixed | Test client/godot/core/screen_effect_core/tests/test_playback.gd:230 calls `flash` with rise, hold and fall 0 on an initialized module and checks `Completed` when it returns, opacity 0 and one `ScreenEffectStartedEvent` of `Cutscene`. Restored in the temporary clone by deleting `_publish_started(channel)` of the all-zero branch (screen_effect_core.gd:140): the test failed (`[] != [1]` one event of the channel). Restored separately by deleting `handle._finish(ScreenEffectResult.COMPLETED)` of that branch (:141) and running `--file` test_playback.gd: the test failed (`the handle has no result yet`) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: the owner parameters are `Variant` and a freed owner gives a `Failed` handle with one error and keeps the current handle; test_input_check.gd:120 fails when the `Object` parameter type is restored |
| D2 | fixed | none | Same as R1-2: test_playback.gd:245 reaches the failure branch of `_play` and fails when that branch is removed |
| D3 | fixed | none | Same as R1-3: test_playback.gd:230 covers the all-zero `flash` on an initialized module and fails when its `_publish_started` or `_finish` call is removed |

## must fix

none

## unknown

- Only the browser run (`ogw core test godot --web ScreenEffectCore`) was not run by this review; the native run of the unmodified checkout passed and the restorations were run natively
- The core tests of the modules that depend on ScreenEffectCore were not run by this review (the core agent report says they passed; `ogw review run` runs them after each fix)
- client/godot/core/screen_effect_core/screen_effect_core_node.gd, screen_effect_handle.gd beyond `_finish`, screen_effect_waiter.gd, dev/ and events/ were not changed in the range and were not read
