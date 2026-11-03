# review RequirementCore round 1

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

- The range changes no file under `client/godot/core/requirement_core/`, and no file of its callers (`TutorialCore`, `ShortcutCore`, `BadgeCore`, `CutsceneCore`). `core-spec/RequirementCore.json` and `fixtures/requirement-evaluation.json` are also unchanged. Of its dependencies, the range changes only `client/godot/core/localization_core/localization_core.gd`, and only the buffer type of `list_languages`. RequirementCore does not call `list_languages`.
- Places in the range that reach this module, checked by reading: `tools/data-tool/src/corespec.ts:196` and `:242`. The `requirement` table now goes through the closure, and the enums of its header go into core data. For a game that uses RequirementCore the result is the same as before: `RequirementLogic` already came from the module's own `enums`, `RequirementType` is not in `allEnums` because the game sets it, and `requirement` is still not added to `data.tables`. `tools/data-tool/src/godotgen.ts:58` changes only float vector lists, and the `requirement` table has no vector column.
- Checked by running: `ogw core test godot RequirementCore` gives `RequirementCore pass`, and `tools/data-tool/tests/coredata.test.ts` and `tests/corespec.test.ts` pass (15 tests). `ogw core spec`, which that core test runs, left `core-spec/` unchanged. The result may be a kept passing result (`ogw core test` reuses a pass with the same key), so this review does not state that the tests ran again in this job. The browser run (`--web`) was not run.
- Code outside the range was read for `client/godot/core/requirement_core/*.gd` and against the test names in `tests/`, and no problem with evidence was found. It was not checked line by line against every sentence of the defining documents, because problems unrelated to the range are not findings of this round. Only `test_time.gd` and `test_error.gd` were read in full, and `test_cache.gd` and `test_watch.gd` in part; the other test files were checked by test name only. No defect was restored to prove that a test fails.
- Not checked: a judge hook that reads `UserStateCore.get_user_created_at`. `user-state-core.md:95` says `set_user_created_at` publishes `UserStateChangedEvent` without changing the change number, so a cached result of such a non-time-dependent condition may stay after that event. No core module registers a judge hook that reads that value (the one core reader outside `UserStateCore` is `client/godot/core/ad_core/ad_core.gd:489`), and whether content can reach this before the value is set was not reproduced, so it is not written as a problem.
- Not checked: `server/core/validation/requirement.ts` beyond its fixture test name. It was reviewed in `records/review/validation-1.md`, and the server side of the fixture `requirement-evaluation` did not run in this review.
