# review ScreenEffectCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/screen_effect_core/screen_effect_core.gd:87: medium A destroyed owner does not give a `Failed` handle, which open-game-works-core/skills/client-core/modules/screen-effect-core.md:106 requires. `fade`, `flash` (:118) and `play_preset` (:153) declare `owner: Object`, and Godot rejects a freed object for a typed `Object` parameter before the function body runs, so the `is_instance_valid(owner)` check in `_check_request` (:429) is never reached with a freed object. A one-file script on Godot 4.7.2 with `static func f(owner: Object)`, called with a freed `Node`, stopped with `SCRIPT ERROR: Invalid type in function 'f' ... argument 1 (previously freed)`, and the caller's next line did not run. So `fade(WORLD, freed_node, ...)` returns no handle and aborts the calling function, with no ScreenEffectCore `error` log. client/godot/core/screen_effect_core/tests/test_input_check.gd:32 passes only `null`, so no test covers a destroyed owner. `clear_owner` (:209) has the same parameter type. Direction: take the owner as `Variant` in an input boundary function, as `TweenCore.play` does for its target (client/godot/core/tween_core/tween_core.gd:157), and add a test with a freed owner
- client/godot/core/screen_effect_core/screen_effect_core.gd:350: medium The failure branch of `_play` has no test. open-game-works-core/skills/client-core/modules/screen-effect-core.md:82 requires that when `TweenCore` cannot start playback, the new handle ends with `Failed`, the replaced handle ends with `Cancelled`, and the channel has no effect. None of the six test files under client/godot/core/screen_effect_core/tests/ makes `TweenCore.play` fail: none calls `TweenCore.release`, and no other test setup reaches this branch. Direction: while a fade plays, call `TweenCore.release` and request a new fade in the same frame, then check the three results
- client/godot/core/screen_effect_core/screen_effect_core.gd:135: medium The all-zero path of `flash` has no test on an initialized module. open-game-works-core/skills/client-core/modules/screen-effect-core.md:79 applies to every request type, and the same spec's `## test` lists duration 0 among the cases where `wait_result` settles once. The only all-zero `flash` call is client/godot/core/screen_effect_core/tests/test_lifecycle.gd:43, before `init`, where it returns `Failed` from `_check_request` and never reaches this branch. The duration 0 tests use `fade` (test_handle.gd:27, test_input_check.gd:61) and `play_preset` (test_input_check.gd:62, test_playback.gd:144). Direction: add a `flash` with rise, hold and fall 0 that checks `Completed` when the operation returns, opacity 0 and one `ScreenEffectStartedEvent`

## debt

none

## must fix

none

## unknown

- The commit range changes no file under client/godot/core/screen_effect_core/ and no ScreenEffectCore spec. ScreenEffectCore reaches the changed UICore code only through `UICore.get_layer`, which the range does not change. It does not call the new `UICore.is_dimmed`. I did not check whether the new `dimmed` value in client/godot/core/qa_core/dev/qa_query.gd:271 is listed for an overlay, because that code is QACore's.
- I did not run the core tests (GUT, `ogw core test`). The three lines in `## out of scope` come from reading all ScreenEffectCore code and tests, plus the one-file Godot script.
- The freed-object behavior was run on the one-file script with the same parameter form, on the debug engine binary. I did not run it through `ScreenEffectCore.fade` itself or on a release export template.
- I did not check whether a `wait_result` caller that resumes inside `ScreenEffectCore._on_frame` can reach `ScreenEffectCore.release` in that same call, which would make the loop read an emptied `_current`. I did not follow `BootstrapCore._on_restart_request` far enough to tell.
- I did not check the web pass.
