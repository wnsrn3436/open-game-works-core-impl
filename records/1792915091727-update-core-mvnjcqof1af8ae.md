# update core: QACore (client core, godot)

## done

- `QACore` (Godot): the budget branch of `step` reads `TimeCore.get_step_budget` and then `TimeCore.is_paused` once per frame while it waits. A budget of 0 ends the `step` with `ok` = `true`; otherwise a `true` `TimeCore.is_paused` fails it with `game time is paused` without waiting for the command time limit, and the existing `on_fail` (`_clear_step_budget`) sets the remaining budget to 0 with `TimeCore.set_step_mode`(true). The lockstep branch is unchanged. `client/godot/core/qa_core/dev/qa_builtins.gd` `_step`
- Core tests (`client/godot/core/qa_core/tests/test_state.gd`), in place of `test_step_over_its_time_limit_after_a_pause_leaves_no_budget`, which checked the old time-limit failure:
  - `test_a_pause_during_a_step_fails_it_by_the_next_frame`: `TimeCore.set_paused`(true) after `step`(1000) is sent and while its budget remains → `ok` = `false` (`game time is paused`) and the process frame count at the end is at most one past the frame of the call, so it ends well before the command time limit. Game time does not move, `step_budget_ms` is 0, step mode stays on, and no budget runs after unpausing
  - `test_a_step_whose_budget_ran_out_in_the_frame_of_a_pause_succeeds`: the test frame that uses up the 100 ms budget and `TimeCore.set_paused`(true) happen in the same frame → `ok` = `true`, game time moved by 100, no warning
- `core-spec/`: no change. `ogw core spec` (run by each `ogw core test`) left it unchanged, because the spec change is behavior text only
- Runs: `ogw core test godot BootstrapCore QACore UnitTestCore --web` passed all three modules. The native `ogw core test godot BootstrapCore QACore UnitTestCore` passed BootstrapCore and UnitTestCore, but QACore was `skipped` twice (`render pass not run: the macOS screen is locked or the display sleeps`). Before that, the native `--file client/godot/core/qa_core/tests/test_state.gd` run, which holds both new tests, passed. `ogw code check core`: type check, lint, dependency and secret all passed

## spec proposals

none

## review

none

## unverified

- The full native QACore test module did not run because the screen was locked (`skipped`). Only `test_state.gd` passed natively (a `--file` run, which leaves no test record). The full module passed in the browser run
