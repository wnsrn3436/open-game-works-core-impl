# review ScreenEffectCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/screen_effect_core/screen_effect_core.gd:87: medium A destroyed owner does not give a `Failed` handle, which open-game-works-core/skills/client-core/modules/screen-effect-core.md:106 requires. `fade`, `flash` (:118), `play_preset` (:153) and `clear_owner` (:209) declare `owner: Object`, and Godot rejects a freed object for a typed `Object` parameter before the function body runs, so the `is_instance_valid(owner)` check in `_check_request` (:439) is never reached with a freed object. Run in this review on Godot 4.7.2: a one-file script with `static func f(owner: Object)` called with a freed `Node` stopped with `SCRIPT ERROR: Invalid type in function 'f' ... argument 1 (previously freed)`, and neither the function body nor the caller's next line ran. So `fade(WORLD, freed_node, ...)` returns no handle and aborts the calling function, with no ScreenEffectCore `error` log. client/godot/core/screen_effect_core/tests/test_input_check.gd:32 passes only `null`, so no test covers a destroyed owner. Same problem as debt list D1, which this review does not have in its scope. Direction: take the owner as `Variant` in an input boundary function, as `TweenCore.play` does for its target (client/godot/core/tween_core/tween_core.gd:157), and add a test with a freed owner
- client/godot/core/screen_effect_core/screen_effect_core.gd:350: medium The failure branch of `_play` has no test. open-game-works-core/skills/client-core/modules/screen-effect-core.md:82 requires that when `TweenCore` cannot start playback, the new handle ends with `Failed`, the replaced handle ends with `Cancelled`, and the channel has no effect. None of the test files under client/godot/core/screen_effect_core/tests/ calls `TweenCore.release` (0 matches in each file), and no other test setup makes `TweenCore.play` return an invalid handle. Same problem as debt list D2, which this review does not have in its scope. Direction: while a fade plays, call `TweenCore.release` and request a new fade in the same frame, then check the three results
- client/godot/core/screen_effect_core/screen_effect_core.gd:135: medium The all-zero path of `flash` has no test on an initialized module. open-game-works-core/skills/client-core/modules/screen-effect-core.md:79 applies to every request type, and the same spec's `## test` lists duration 0 among the cases where `wait_result` settles once. The only all-zero `flash` call is client/godot/core/screen_effect_core/tests/test_lifecycle.gd:43, before `init`, where it returns `Failed` from `_check_request` and never reaches this branch. Same problem as debt list D3, which this review does not have in its scope. Direction: add a `flash` with rise, hold and fall 0 that checks `Completed` when the operation returns, opacity 0 and one `ScreenEffectStartedEvent`

## debt

none

## must fix

none

## unknown

- The commit range changes no file under client/godot/core/screen_effect_core/, no ScreenEffectCore spec and no code that ScreenEffectCore calls. Its only code change is `LocalizationCore._restore_heading_types` (client/godot/core/localization_core/localization_core.gd:714), which ScreenEffectCore reaches only as a transitive dependency through `UICore`. Overlays are `ColorRect`s without text or theme fonts, so I found nothing the range causes or reveals here.
- `ogw core test godot ScreenEffectCore` passed, but its result was reused from an earlier run with the same key (`pass (reused)`), so the tests did not run anew in this review. The browser run (`--web`) was not run.
- I did not check whether a test covers the overlay rectangle at `init` alone. client/godot/core/screen_effect_core/tests/test_overlay.gd:18 calls `ResolutionCoreDev.set_test_screen` before its "after init" assert. That call raises `GameAreaChangedEvent` when the headless window differs from 1280x720, and the event also fits the overlays. I did not read the headless window size or run a copy with the `_fit_overlays` call of `init` (screen_effect_core.gd:57) removed, so this is not written as a problem.
- `wait_result` on a settled handle after `release` returns `Failed` with an error log (screen_effect_core.gd:176), not the handle's result. open-game-works-core/skills/core/SKILL.md (operation call after `release`) supports this, while open-game-works-core/skills/client-core/modules/screen-effect-core.md (`### effect handle`, and `release` in the second `## test` item) can be read as requiring the result. test_handle.gd:95 calls `init` again before it checks. I did not settle which reading the specs intend, so this is not written as a problem.
- Last round's open question about `release` running inside the `_on_frame` loop: I checked `BootstrapCore._on_restart_request` (client/godot/core/bootstrap_core/bootstrap_core.gd:1149), which waits for `process_frame` before `_teardown`, so that path does not release inside the loop. I did not check a direct `ScreenEffectCore.release` call from a `wait_result` caller, because the non-test lines that use `ScreenEffectCore.` in client/godot/core outside its folder have no `release` call. I did not check content code, or how `BootstrapCore` calls `release` beyond `_teardown`.
- The game repos and the release export template were not checked. The freed-object run used the debug engine binary on a one-file script, not `ScreenEffectCore.fade` itself.
