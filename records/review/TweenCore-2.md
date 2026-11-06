# review TweenCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/tween_core/tween_core.gd:564 | Continues R1-1. The changed tween-core `## DEV` now sets "the skip end of a frame": one end handling of the skipped tweens requested before it started, and a skipped tween requested after it started (a completion callback, code resuming after `wait_end`) ends in the skip end of the next frame, "so a chain of skipped tweens advances one step per frame ... and the frame ends". The implementation did not change in the range: `_flush_end_due` clears `_flush_queued` before it ends the tweens (tween_core.gd:567), so a request from a callback calls `_queue_end_due` (tween_core.gd:555), which queues another deferred `_flush_end_due` that Godot runs in the same deferred flush; and the `for slot` loop (tween_core.gd:572) also ends in the same pass a new skipped tween that took a higher slot. Reproduced in a temporary copy of the project (Godot 4.7.2, headless GUT): with `TweenCoreDev.set_finite_skip(true)`, a completion callback that calls `TweenCore.play(move(100), target, options)` again until 200 completions got all 200 within 3 process frames; a loop `play` + `await TweenCore.wait_end(h)` ran 200 iterations with `Engine.get_process_frames()` difference 0. Without a cap, the frame never ends. The new `## test` item ("a completion callback that plays the same finite tween again, and a loop that plays a finite tween and waits for its `wait_end`, each get one `Completed` per frame, and each of those frames ends") has no test in client/godot/core/tween_core/tests/ | Implement the skip end of a frame: when it starts, take the set of skipped tweens requested before it (e.g. a skip generation number stored in the record at request, or a separate list swapped at flush start) and end only those; a skipped tween requested during or after it waits for the skip end of the next frame (e.g. queued from the core node frame processing or the next `process_frame`, not a deferred call of the current flush). Add the core tests of the new `## test` item: the callback chain and the `wait_end` loop each get one `Completed` per process frame | no | 92 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | The spec now settles the bound (tween-core `## DEV` skip end of a frame), but tween_core.gd:536-576 is unchanged in the range and the repro still ends the whole chain in one frame (see R2-1) |
| R1-2 | fixed | client/godot/core/tween_core/tests/test_finite_skip.gd:110 adds `test_preset_requested_before_the_skip_plays_when_its_load_ends_while_the_skip_is_on`. In a temporary copy, with `record.finite_skip = record.finite_skip or _finite_skip` added after `_load_definition(record, definition)` in `_load_preset` (tween_core.gd:492), that test failed (started count 0, position 100 at 50 ms, one end reason) and the other 7 passed; with the code restored all 8 passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only test_finite_skip.gd (unchanged code and the R1-2 mutation) and a temporary repro test were run, in the headless GUT run of a temporary copy without a test host; the whole TweenCore suite and the core tests of modules that depend on TweenCore were not run
- The R2-1 repro was not run in an instance with QACore and a reward window
- The QACore and SoundCore changes in the commit range were not reviewed; they are outside this target
