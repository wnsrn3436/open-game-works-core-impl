# review TweenCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `test_completion_callback_that_plays_two_finite_tweens_ends_both_in_the_next_frame` (client/godot/core/tween_core/tests/test_finite_skip.gd:220) has a completion callback play `a` (the freed lowest slot) and `b` (a higher slot) and checks that both end in the next process frame. Restored in a temporary copy of client/godot (outside the checkout, Godot 4.7.2 headless GUT 9.7.1 with the `gut_pre_run.gd`/`gut_post_run.gd` scripts of `ogw core test`): `if record.skip_due and record.skip_seq <= last:` at client/godot/core/tween_core/tween_core.gd:626 changed to `if record.skip_due:`. That test fails at :232 with `{ "first": 102, "b": 102, "a": 103 }` against `{ "first": 102, "a": 103, "b": 103 }` (73 pass, 2 fail; the other failure is the R3-3 test) |
| R3-2 | fixed | `test_skipped_tween_waiting_for_the_next_frame_does_not_progress_while_the_clock_moves` (client/godot/core/tween_core/tests/test_finite_skip.gd:250) plays a skipped `play_value` FLOAT 10→20 from a completion callback and moves the test clock 50 ms while it waits. Restored in the temporary copy: `if record.end_due or record.skip_due:` at client/godot/core/tween_core/tween_core.gd:653 changed to `if record.end_due:`. That test fails at :257 with `[15.0, 15.0, 20.0]` against `[20.0]` (73 pass, 2 fail; the other failure is the R3-3 test at :295, receiver called once) |
| R3-3 | fixed | `_skip_end` now ends a waiting skipped record for which `_is_gone(record)` holds with `TargetDestroyed` (client/godot/core/tween_core/tween_core.gd:627); `_end` applies no end state for that reason (:773), so the property is not changed and the receiver is not called, and no log is left, as in the `_on_frame` path (:656). `test_skipped_tween_whose_target_is_destroyed_while_it_waits_ends_with_target_destroyed` (client/godot/core/tween_core/tests/test_finite_skip.gd:280) `queue_free`s a target node and a receiver node while their skipped tweens wait. Restored in the temporary copy: line :627 changed back to `_end(slot, TweenEndReason.COMPLETED)`. That test fails at :291 (`[1]` against `[4]`) and :292 (`{ 0: 1, 1: 1 }` against `{ 0: 4, 1: 4 }`) (74 pass, 1 fail). Unmutated copy: 75/75 pass |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the TweenCore suite (75 tests) ran, in headless GUT in a temporary copy without a test host. The core tests of the modules that depend on TweenCore and the `--web` run were not run
- The `_flush_end_due` path (client/godot/core/tween_core/tween_core.gd:576, outside this range), which ends a zero-cycle tween with `Completed` even when its target was `free()`d between the playback operation and the deferred flush, was not judged: tween-core `## behavior` ("handle and end") sets that the end condition arises inside the playback operation, and does not settle which reason applies when the target is destroyed before that end handling runs
- A skip end that starts in the deferred flush of a physics step, and a skipped request from `_physics_process`, were not tested
- Not run in a game instance with QACore
