# review QACore round 3

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Round 2 had no findings and no `open` rows, so `## previous` has no rows. The only QACore change in the range is the new test `test_the_frame_code_that_ends_a_reward_window_allocates_no_memory` (`client/godot/core/qa_core/tests/test_feedback_switch.gd:355`). It was checked in copies of `client/godot` (with `addons/`, `.godot/` and `build/` of the main checkout at 79e12708) in the session scratchpad, run natively headless with GUT `-gselect=test_feedback_switch.gd` and the UnitTestCore pre- and post-run hooks, with no test host. On unchanged code the test passed 3 of 3 runs and the whole file passed 11/11 with no `SCRIPT ERROR:` or `leaked at exit` line. With `var _review_list: Array[bool] = [false, false, false, false, false, false]` put back at the start of `_apply_module_states` (`client/godot/core/qa_core/dev/qa_core.gd:1241`), it fails at `static memory peak: no allocation freed inside the loop`. One earlier run on unchanged code failed only on `LogCore: abnormal exit` at `qa_test_case.gd:155`. That came from an abnormal exit marker another run left in the shared `user://` folder, and the next runs passed
- The loop of the new test (`_end_windows`, `test_feedback_switch.gd:385`) reopens the window by setting `_reward_window_open` and does not change `_module_states`, so the measured section never reaches `_set_module_state` or the DEV setters of SoundCore and TweenCore that a real window end calls. The spec does not say that a reward window end allocates no memory (`qa-core.md:239`, `:429`, `:430`). Those calls follow only the frame code rules (`engines/godot.md:466`), so this is not a finding
- The browser run (`--web`) and the tests of QACore's other files and of its dependents were not run in this review. The core agent report says `ogw core test godot QACore BootstrapCore UnitTestCore` and the same with `--web` pass on 43ea6605
- The SoundCore test change in the range (`client/godot/core/sound_core/tests/test_dev_feedback.gd`) and the review records of other modules are not QACore code and were not reviewed
- The core agent's spec proposal (add the ballast peak method to the memory test rule in `engines/godot.md:560`) is a change to the harness documents and was not judged here
