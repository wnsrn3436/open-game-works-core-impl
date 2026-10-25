# review CutsceneCore round 1

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

- The commit range 47b588d..bcdb386 changes no CutsceneCore file. It changes only RequirementCore (the frame code checks the destroyed owners only through the new `_owner_slots` list, client/godot/core/requirement_core/requirement_core.gd:55, :501-502, :517-518, :627-631, :750), QACore (a `step` command fails when game time is paused, client/godot/core/qa_core/dev/qa_builtins.gd:765-768), BootstrapCore (the fatal screen label uses `ThemeDB.fallback_font`, client/godot/core/bootstrap_core/bootstrap_core.gd:1125-1126), their tests and run records. Checked how these reach CutsceneCore:
  - CutsceneCore calls only `RequirementCore.evaluate` (`Branch`, client/godot/core/cutscene_core/cutscene_core.gd:940; locked choice, cutscene_core.gd:1460). The range does not change `evaluate` (requirement_core.gd:151-166) or `_evaluate_entry`; it changes only the watch bookkeeping and `_on_frame`. CutsceneCore makes no watch (no `RequirementCore.watch` in client/godot/core/cutscene_core). `_remove_watch_at` (requirement_core.gd:505-521) calls no callback, so the backward loop of `_on_frame` cannot have its list shrunk by a nested removal
  - The CutsceneCore tests init RequirementCore and register time-dependent judges (client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd:148, :167-177) and only evaluate through `Branch` and `Choice`; the frame-memory tests call only `CutsceneCore._on_frame` (client/godot/core/cutscene_core/tests/test_frame_memory.gd:11-15), so the changed RequirementCore frame code is not in what they measure
  - The cutscene pause sets `TimeCore.set_paused(true)` (cutscene_core.gd:1713-1714). With the QACore change, a QA `step` command run during a cutscene pause now fails with "game time is paused". That is QACore behavior and does not change CutsceneCore behavior. No CutsceneCore test uses QACore; client/godot/core/cutscene_core/tests/test_focus.gd:61 names it only in a comment and injects input through `InputCoreDev`
  - CutsceneCore does not call BootstrapCore and sets no font (`ThemeDB` has no match in client/godot/core/cutscene_core)
- The CutsceneCore tests were not run in this review (`ogw core test` needs the GUT setup and the test host, and writes import files in the checkout). Whether they pass at bcdb386 is not checked here
- CutsceneCore code that does not interact with RequirementCore, TimeCore pause or the changed modules was not read in full: with a commit range, only problems the range causes or reveals are findings, and the range does not reach it
