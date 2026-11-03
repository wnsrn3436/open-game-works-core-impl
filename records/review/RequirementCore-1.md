# review: RequirementCore round 1

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

- The commit range changes no file under `client/godot/core/requirement_core/`. Its only implementation change is `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd:714`, with its test and `records/` files. RequirementCore uses only the `FormatArgs` type of `LocalizationCore` (`client/godot/core/requirement_core/requirement_core.gd:281`), which the range does not change, and no file of RequirementCore or its tests uses a heading type or a theme. So that change does not reach RequirementCore.
- Run in this review: `ogw core test godot RequirementCore` passes on the target commit. The result was reused from a passing result of the same key, not run again. `--web` was not run here.
- The commit range is not `none`, so the whole target was not reviewed to the standard of a full review. All implementation files of `client/godot/core/requirement_core/` were read against the spec and `## frame code` of the `godot` engine rules, and this reading found no problem. Of the tests, `tests/test_time.gd` and the first part of `tests/test_cache.gd` were read, and of the other test files only the test names, which were compared with `## test` of the spec. `## out of scope` being `none` means that this reading found no problem, not that the target was checked in full. Whether each of the other tests fails when the code is changed was not checked.
- The server side of `### server evaluation` (`validation.evaluate_requirement`) and the content of the core test fixture `requirement-evaluation` were not read, so the equality of client and server judgement rests on the passing tests only.
- The callers `TutorialCore`, `ShortcutCore`, `BadgeCore` and `CutsceneCore` were not read, because the range changes neither them nor RequirementCore.
- The spec says the batch evaluation runs before the content update of the next frame, and the batch runs in `_process` of the core node at `process_priority` -1000 (`client/godot/core/requirement_core/requirement_core.gd:809`). `_physics_process` of content code runs before `_process` of that frame, so it runs before the batch. The defining documents do not say whether `_physics_process` counts as a content update, so this is not written as a finding.
