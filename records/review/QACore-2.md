# review QACore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/qa_core/tests/test_state.gd:245 | `test_a_step_whose_budget_ran_out_in_the_frame_of_a_pause_succeeds` waits for the `step` command to add its budget with `for i: int in 5: if TimeCoreDev.get_step_budget() > 0: break; await UnitTestCore.wait_frames(1)`, a polling loop with a frame count limit. `client-core/modules/unit-test-core.md` `### async wait` says an async wait is not done with a polling loop that has a frame count limit, and a condition without an event is checked every frame with no frame count limit. The budget is added by a deferred call: `start_command` → `QACore.run_command` → `_submit` queues the command and calls `_schedule_pump` (`client/godot/core/qa_core/dev/qa_core.gd:405`), which runs `_pump` with `call_deferred` (`qa_core.gd:414`). `_pump` → `_start` → `_execute` → `_BUILTINS.run` → `_step` then reaches `TimeCoreDev.add_step_budget` (`client/godot/core/qa_core/dev/qa_builtins.gd:764`) with no await before it. So the target is a deferred call, the one case where `wait_frames` is allowed. The commit range is empty, so the code is the same as when the debt item was written. The harness check `frame polling` (`tools/src/commands/check/static/frame-polling.ts` in the harness) flags every `for`/`while` loop that awaits frames, but it only scans `isClientTest` paths, so this core test is not blocked. This is the only frame-capped polling loop in the QACore tests: the other loops that await frames (`test_state.gd:54`, `test_render_capture.gd:190`, `test_render_capture.gd:202`) are `while` loops with no frame count | Replace the loop with one `await UnitTestCore.wait_frames(1)` (the deferred `_pump` runs before the next frame), then keep the `assert_eq(TimeCoreDev.get_step_budget(), 100, ...)` | no | 90 |

## previous

none (round 1 `records/review/QACore-1.md` has no findings and no open rows)

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R2-1 | `client/godot/core/qa_core/tests/test_state.gd:245`-`248` is unchanged (the commit range is empty), and the loop still waits on a condition with a frame count limit of 5. See R2-1 |

## must fix

none

## unknown

- The commit range `6c62379..6c62379` is empty, so no changed code was reviewed. This round covers only input item D1 and the rows of the previous round (round 1 has none)
- `finish` (`client/godot/core/qa_core/tests/support/qa_test_case.gd:216`) waits for `Pending.done` in a loop that calls `advance(step_ms, 1)` at most `frames` times, even though `Pending` has a `finished` signal. The loop also moves the test clock forward, which the commands need in order to make progress, and some tests use its frame limit on purpose as an assertion (`finish(step, 16, 3)` in `test_state.gd:223` and `test_state.gd:254`). I could not decide with confidence 80 or more whether `### async wait` forbids this clock-driving loop, so it was not judged. It is older than this range
- The Godot core tests were not run in this review. The claim that one `wait_frames(1)` is enough for the deferred `_pump` comes from reading the code, not from running it
