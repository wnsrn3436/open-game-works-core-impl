# review TweenCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/tween_core/tween_core.gd:545 | While the finite skip is on, `_begin` queues every finite tween for `_flush_end_due` (tween_core.gd:564), which runs as a deferred call. Godot runs deferred calls queued during a deferred flush in the same idle time, so a completion callback that plays a finite tween again (a common way to chain or loop a presentation, e.g. a pulse on a reward screen) completes, replays and completes again with no frame in between. Reproduced in a temporary copy of the project: `TweenCoreDev.set_finite_skip(true)`, then `play(move(100), target, options)` whose callback calls `TweenCore.play(move(100), target, options)` again until a cap of 5000; all 5000 completions ran inside 1 process frame (`Engine.get_process_frames()` difference 1). Without the cap the frame never ends and the game hangs. With the skip off, the same code plays once per 100 ms. QACore keeps the skip on while the reward window is open (qa-core `module state`), and that window closes only when time passes at a later frame start, which never comes once the frame hangs. The spec requires this end time (tween-core `## DEV`: "at the time a tween whose definition has cycle time 0 ends"), so the spec has to change too | Set in the spec, and implement, a bound on skipped ends: e.g. a tween requested during the skip from inside the end processing of a skipped tween (its completion callback or `wait_end` continuation) ends at the next frame rather than in the current flush, or the skip ends at most one chain step per frame. Add a core test where a completion callback replays a finite tween during the skip and the frame ends | yes | 90 |
| R1-2 | spec | medium | client/godot/core/tween_core/tests/test_finite_skip.gd:90 | tween-core `## DEV` says: "A tween requested before it turned on goes on, also when its playback starts while it is on". No test covers that case: `test_skip_of_a_loading_preset_is_decided_at_its_request` turns the skip off (test_finite_skip.gd:98) before the presets finish loading, so the preset requested before the skip starts its playback with the skip off. Checked in a temporary copy: with tween_core.gd:491 followed by `record.finite_skip = record.finite_skip or _finite_skip` (the skip decided again at load), all 7 tests of test_finite_skip.gd still pass, although that code skips a preset requested before the skip turned on | Add a test: `play_preset` of a preset that is not loaded, then `set_finite_skip(true)`, keep the skip on until the load ends, and assert that the tween publishes `TweenStartedEvent`, is playing and progresses over its duration | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- R1-1 was reproduced only in the headless GUT run of a temporary copy of the project (Godot 4.7.2); it was not run in an instance with QACore and a reward window
- The QACore, PoolCore, SoundCore, ScreenEffectCore and CameraCore changes in the commit range were not reviewed; they are outside this target. The QACore call of `TweenCoreDev.set_finite_skip` (client/godot/core/qa_core/dev/qa_core.gd:1277) was read only to check how the skip is turned on
- The whole TweenCore test suite and the core tests of modules that depend on TweenCore were not run; only test_finite_skip.gd (with the R1-2 mutation) and a temporary repro test were run
