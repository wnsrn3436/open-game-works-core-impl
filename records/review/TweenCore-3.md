# review TweenCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | test evidence | medium | client/godot/core/tween_core/tests/test_finite_skip.gd:170 | The request-number check `record.skip_seq <= last` in `_skip_end` (client/godot/core/tween_core/tween_core.gd:625) has no test that fails without it. Both new chain tests play the next tween from the callback or from the `wait_end` continuation after `_free_slot` of the ended tween, so `_take_slot` returns the same slot again (client/godot/core/tween_core/tween_core.gd:1312, :1327). The `for slot` loop of `_skip_end` has already passed that slot, so the frame check in `_queue_skip_end` (:597) alone keeps the chain at one step per frame. Mutation in a temporary copy (Godot 4.7.2, headless GUT): with `if record.skip_due and record.skip_seq <= last:` changed to `if record.skip_due:`, all 72 tests of client/godot/core/tween_core/tests/ pass. In the same mutated copy, a repro test whose completion callback plays two finite tweens on two targets got `{ "first": 0, "b": 0, "a": 1 }`: the second tween took a higher slot and ended in the same skip end as the tween whose callback requested it. That breaks tween-core `## DEV` ("A skipped tween requested after the skip end of its frame started ... ends in the skip end of the next frame"). On the unmutated code the same repro gets `{ "first": 0, "a": 1, "b": 1 }` | Add a core test in which a skipped tween requested during a skip end takes a slot above the slot being ended, for example a completion callback that plays two finite tweens, or a callback chain with another tween already in a lower slot. Check that each tween requested in the callback ends in the next process frame | no | 92 |
| R3-2 | test evidence | medium | client/godot/core/tween_core/tween_core.gd:652 | No test fails without the new `or record.skip_due` guard in `_on_frame`. That guard is what keeps a skipped tween that waits for the next frame's skip end from progressing. Mutation in a temporary copy: with `if record.end_due or record.skip_due:` changed to `if record.end_due:`, all 72 tests of client/godot/core/tween_core/tests/ pass. In the same mutated copy, a repro test whose completion callback plays a skipped `play_value` of FLOAT 10→20 over 100 ms and then calls `UnitTestCore.advance_clock(50, false)` recorded receiver values `[15.0, 15.0, 20.0]`. That breaks tween-core `## DEV` ("does not progress") and `## test` ("A `play_value` calls the receiver with the end value once"). On the unmutated code it records `[20.0]`. The existing skip tests never move the clock while a skipped tween waits for the next frame | Add a core test in which a skipped tween waits for the next frame's skip end while the test clock moves: a `play_value` that a completion callback requests during a skip end, or a property tween checked after the core node's frame processing of the next frame. Check that the receiver is called once, with the end value, and that the property does not take an intermediate value | no | 88 |
| R3-3 | spec | medium | client/godot/core/tween_core/tween_core.gd:652 | `_on_frame` now skips the target-destruction check (`_is_gone`) for `skip_due` records, and those records can wait one frame (they could not before this range). A skipped tween whose target is destroyed while it waits is then ended by `_skip_end` (:625) with `Completed`, and `_apply_end_state` sets nothing (:801). tween-core `## behavior` sets `TargetDestroyed` for this case, with the property value not changed, "before the end of the frame after the frame in which the target object ... is destroyed" (`## test`: "When the target object is destroyed, the tween ends with `TargetDestroyed` before the next frame ends"). Its `Completed` row means the target value was applied. Repro in a temporary copy: with the finite skip on, a completion callback plays `move(100)` on node X and then calls `X.queue_free()`. X is deleted at the end of that frame. In the next frame, the callback of the tween on X receives `[1]` (`Completed`) and `is_instance_valid(X)` is false. A content callback that touches its target on `Completed` then reaches a freed object, though it never would in a run without the skip. Before this range the tween ended in the same frame's deferred flush, before the delete queue, so `queue_free` could not cause this. A value tween whose receiver is destroyed while it waits also ends with `Completed` without a receiver call (:798) instead of `TargetDestroyed` | In `_skip_end`, end a record for which `_is_gone(record)` holds with `TweenEndReason.TARGET_DESTROYED` instead of `Completed`, or keep the `_is_gone` check of `_on_frame` for `skip_due` records. Add a core test: a skipped tween waiting for the next frame's skip end whose target is freed ends with `TargetDestroyed` | no | 80 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `_queue_skip_end`, `_queue_skip_call` and `_skip_end` (client/godot/core/tween_core/tween_core.gd:592-630) end only the skipped tweens numbered up to the request number taken when the skip end starts. A tween requested after the skip end of its frame started sets `_skip_waiting`, and `_on_frame` of the next frame queues the next skip end (:640). Temporary copy: test_finite_skip.gd passes 10/10 with the current code. With tween_core.gd and tween_record.gd restored to 0e89ed65, `test_completion_callback_that_plays_a_finite_tween_again_gets_one_completed_per_frame` (:170) and `test_loop_that_plays_a_finite_tween_and_waits_for_its_wait_end_gets_one_completed_per_frame` (:184) fail with a frame difference of 0 for ends 1-4. Gaps in the tests of this fix are R3-1 and R3-2 |
| R1-1 | fixed | Same change and tests as R2-1: a chain of skipped tweens now advances one step per process frame, and the frame ends |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only the TweenCore suite (72 tests) ran, in headless GUT in a temporary copy without a test host, together with temporary repro tests and mutations. The core tests of the modules that depend on TweenCore and the `--web` run were not run
- A skip end that starts in the deferred flush of a physics step is not tested, and neither is a request from `_physics_process`. The frame-number logic was checked only by reading the code and against the Godot main loop order (process frame counter raised after the process step and its flushes)
- Not run in a game instance with QACore and a reward window
