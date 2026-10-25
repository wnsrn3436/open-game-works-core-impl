# review QACore round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `client/godot/core/qa_core/tests/test_state.gd:245`-`246`: the `for i: int in 5` polling loop is replaced by one `await UnitTestCore.wait_frames(1)`, followed by the unchanged `assert_eq(TimeCoreDev.get_step_budget(), 100, ...)`. The wait target is a deferred call, which `### async wait` of `client-core/modules/unit-test-core.md` allows for `wait_frames`: `start_command` → `_run_into` → `QACore.run_command` → `_submit` appends the command and calls `_schedule_pump` (`client/godot/core/qa_core/dev/qa_core.gd:410`-`415`), which runs `_pump` with `call_deferred`. The previous `run_ok("set_step_mode", ...)` clears `_running` before it emits `finished` (`qa_core.gd:504`-`510`), so a pump scheduled there or by `_submit` starts the `step` command. `_pump` → `_start` → `_execute` → `_BUILTINS.run` (`"step"` → `await _step`) → `_step` reaches `TimeCoreDev.add_step_budget` (`client/godot/core/qa_core/dev/qa_builtins.gd:764`) with no await before it. `wait_frames(1)` awaits `tree.process_frame` once (`client/godot/core/unit_test_core/dev/unit_test_core.gd:1356`-`1361`), and the test clock is not moved before the assert, so the budget is not consumed before it is read. R2-1 is a `spec` finding, not `test evidence`, so no defect restore was needed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | The frame-capped polling loop at `client/godot/core/qa_core/tests/test_state.gd:245` is gone (commit f45be1d). See R2-1 in `## previous` |

## must fix

none

## unknown

- The Godot core tests were not run in this review. That one `wait_frames(1)` is enough for the deferred `_pump` comes from reading the code; the core agent report says `test_state.gd` passed 13/13 in a native run and the `--web` run passed, and that the native render pass did not run because the screen was locked
- `finish` (`client/godot/core/qa_core/tests/support/qa_test_case.gd:216`) waits for `Pending.done` in a loop of at most `frames` iterations that also moves the test clock, and some tests use that limit as an assertion (`test_state.gd:223`, `test_state.gd:253`). It is older than this range and unchanged by it; as in round 2, whether `### async wait` forbids this clock-driving loop was not judged with confidence 80 or more
