# QACore review fix round 2

## done

- QACore (godot): added `test_the_frame_code_that_ends_a_reward_window_allocates_no_memory` to `client/godot/core/qa_core/tests/test_feedback_switch.gd` (commit 43ea6605). This is the test for the R1-1 fix (no `Array` literal in `_apply_module_states`), so `fix test proof` now has a test that fails on the code before the fix.
  - It runs the frame code that ends a reward window (`QACore._check_reward_window` → `_apply_module_states`) 100 times as warm-up, then 1000 times measured after `LogCore.release`. It uses the ballast peak method that `remote_config_core/tests/test_values.gd` already uses: a `PackedByteArray` raises `MEMORY_STATIC` to `MEMORY_STATIC_MAX`, so even an allocation that is freed inside the loop raises the peak. The test then asserts that `OBJECT_COUNT`, `MEMORY_STATIC` and `MEMORY_STATIC_MAX` did not grow.
  - Proof: with `client/godot/core/qa_core/dev/qa_core.gd` of ac768442 (before the fix) put back in the worktree, `ogw core test godot QACore --file client/godot/core/qa_core/tests/test_feedback_switch.gd` fails at `static memory peak: no allocation freed inside the loop`. With the fixed code it passes.
  - The R1-2 test (`test_frame_interval.gd`) is a `test evidence` fix: the code it checks already behaved correctly before the fix, so it cannot fail on ac768442. It is left unchanged.
- `ogw core test godot QACore BootstrapCore UnitTestCore` and the same with `--web`: pass on 43ea6605. `ogw code check core`: pass (type check, lint, dependency, secret).
- No engine-specific implementation rules document was written. `## <engine> build` of `tools/ogw.md` was not written.

## spec proposals

- godot `## test` (skills/client-core/engines/godot.md:560) says the memory test "catches only allocations that the operation leaves behind, and not allocations made and freed inside the operation. Such allocations are judged by whether the operation's code follows the frame code rules". The ballast peak method (raise `MEMORY_STATIC` to `MEMORY_STATIC_MAX` with a `PackedByteArray` before the measured section, then assert `MEMORY_STATIC_MAX` did not grow) does catch allocations that are freed inside the operation. Two core tests already use it (`remote_config_core/tests/test_values.gd`, `qa_core/tests/test_feedback_switch.gd`). Proposal: add this method to that test rule, so that a frame code allocation like R1-1 is caught by a test and not only by review.

## review

- R1-1: fixed in round 1 (`client/godot/core/qa_core/dev/qa_core.gd:1241`, `_wanted_state` at :1251). Added test in this round: `client/godot/core/qa_core/tests/test_feedback_switch.gd` `test_the_frame_code_that_ends_a_reward_window_allocates_no_memory`. It fails on ac768442 and passes on the fix.
- R1-2: fixed in round 1 (`client/godot/core/qa_core/tests/test_frame_interval.gd:90`). No change in this round.
- `fix test proof` fail of the round-2 code check: fixed by the R1-1 test above.

## unknown

- The new test was proven against the pre-fix code in a native headless run only. The `--web` run was done only on the fixed code, where it passed.
- `fix test proof` itself was not run in this round. It is run by `ogw review next` with `--fix-base`. The equivalent run (pre-fix `qa_core.gd`, new test file) failed as expected.
