# review QACore round 1

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

- The commit range changes QACore only in `step` (`client/godot/core/qa_core/dev/qa_builtins.gd:752`) and its tests (`client/godot/core/qa_core/tests/test_state.gd:211`, `client/godot/core/qa_core/tests/test_state.gd:241`). The budget branch checks `TimeCoreDev.get_step_budget` and then `TimeCore.is_paused` once per frame, and a pause fails it with `game time is paused`. `on_fail` (`_clear_step_budget`) then sets the remaining budget to 0 through `QACore._set_step_mode`(true). This matches `client-core/modules/qa-core.md` `step` and test items 386 and 387. The wait resumes on `SceneTree.process_frame`, which comes before the `_process` of the TimeCore node (`client/godot/core/time_core/time_core.gd:96`). So in each frame, the check reads the budget after the previous frame's game time increase and before this frame's increase. Because of that order, a pause in frame N fails the `step` in frame N+1 at the latest, and a budget that reached 0 in the frame of the pause succeeds. `test_a_step_whose_budget_ran_out_in_the_frame_of_a_pause_succeeds` fails if the two checks are swapped. `test_a_pause_during_a_step_fails_it_by_the_next_frame` fails on the old code (no end within 3 frames) and if `on_fail` is not called (the budget left is not 0). These outcomes were worked out by reading the code, not by running it. The lockstep branch (`_lockstep_step`) is unchanged, and `test_realtime.gd:150` still checks the pause failure that happens before `request_step`
- The other changes in the range are the `BootstrapCore` fatal screen font override (`client/godot/core/bootstrap_core/bootstrap_core.gd:1126`) and the `RequirementCore` owner watch list. QACore calls neither operation. `list_ui` `clipped` reads `get_theme_font("font")`, which returns the own override. So the fatal screen label is measured with the font it draws with
- The Godot core tests were not run in this review. The update-core report says the full native QACore module was `skipped` (screen locked) and only the `--web` run and a native `--file test_state.gd` run passed
