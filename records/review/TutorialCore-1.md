# TutorialCore review round 1

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

- The commit range changes no file of `client/godot/core/tutorial_core/`. It changes `client/godot/core/requirement_core/requirement_core.gd` (owner watch slots), `client/godot/core/bootstrap_core/bootstrap_core.gd` (fatal screen font), `client/godot/core/qa_core/dev/qa_builtins.gd` (`step` fails while game time is paused), their tests, and records
- RequirementCore is the only changed module that TutorialCore calls. Checked: TutorialCore calls `RequirementCore.watch` without an owner object (`client/godot/core/tutorial_core/tutorial_core.gd:521`, `:613`), so its watches never enter `_owner_slots` (`client/godot/core/requirement_core/requirement_core.gd:501`), and `_remove_watch_at` touches `_owner_slots` only for `owner_id != 0` (`client/godot/core/requirement_core/requirement_core.gd:517`). `_on_frame` (`client/godot/core/requirement_core/requirement_core.gd:624`) loops over an empty `_owner_slots` for TutorialCore's watches, and the time recheck and batch evaluation that follow are unchanged. `evaluate`, `unwatch`, `register_judge` and the trigger kinds that TutorialCore and its tests use (`client/godot/core/tutorial_core/tutorial_core.gd:257`, `:451`, `:538`, `:605`, `client/godot/core/tutorial_core/tests/support/tutorial_test_case.gd:169`) are not changed by the range. TutorialCore code and tests read no internal field of RequirementCore (no reference to `_owner_watch_count` or `_owner_slots`)
- TutorialCore and its tests do not call BootstrapCore or QACore, so the changes to the fatal screen and to the QA `step` command do not reach TutorialCore
- The core tests were not run in this review; the conclusion that the TutorialCore tests still pass after the range is from reading the code above
- The rest of TutorialCore code and tests, which the range does not change and which the changes do not reach, was not reviewed
