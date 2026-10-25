# review RequirementCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `init` puts every `GameData.RequirementType` value into `_logged_types` with `false` (client/godot/core/requirement_core/requirement_core.gd:114-115), before the core node is added and so before any frame code runs. `_self_judge` (:386-390) now tests the value with `get(type, false)` and writes `true` only when `has(type)` is already true, so it only changes the value of an existing key and adds no `Dictionary` key in frame code. The log message is still built only as the argument of the `LogCore.log_error` call on the path that writes it (:390), which `engines/godot.md` `## frame code` allows. The type of a requirement row is an `enum<RequirementType>` value, so every value that reaches `_self_judge` has a key and the error stays once per type (`requirement-core.md` error table). `_reset` (:941) still sets `_logged_types = {}`, so `release` deletes the record of types that left an error log (spec `release` rule) and the lifecycle check `test_lifecycle.gd:70` still holds. The new test `test_a_type_without_a_judge_hook_first_judged_in_frame_code_logs_once_without_adding_a_key` (client/godot/core/requirement_core/tests/test_error.gd:37) follows the round-1 run path: the `watch` of `ALL_1` stops at the failed `FlagA` item with no log, then a `TutorialProgressUserState` delta and a content trigger make the next frame's batch evaluation judge `FlagB` (no hook) first. It asserts one error log, `_logged_types.size()` unchanged across that frame, and no second log on a later trigger; with the old `if not has: [type] = true` code the size assert fails (size grows by 1 in the frame). `_collection_sizes` (tests/test_watch.gd:546) now also includes `_logged_types.size()` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | fixed | none | The `%` messages of `_run_batch` and `_self_judge` are each built only as the argument of a `LogCore.log_error` call on the path that writes that log, which the log message exception of `engines/godot.md` `## frame code` allows. The `Dictionary` key add of `_self_judge` is gone: client/godot/core/requirement_core/requirement_core.gd:388-389 writes only an existing key, which `init` (:114-115) put there (see R1-1) |
| D5 | fixed | none | Same as D4 at the current line numbers: the log messages at :390, :393 and in `_run_batch` are within the log message exception, and `_self_judge` :388-389 no longer adds a key (see R1-1) |

## must fix

none

## unknown

- Core tests were not run in this review, and the defect was not restored to run the new test against it. That the new and changed tests pass, and that the new test failed on the old code, rests on the core agent report (records/1792925988424-review-fix-mvnpuamg8eec09.md) and its run log (records/1792925988424-review-fix-mvnpuamg8eec09-runs.json, the final `ogw core test godot RequirementCore --file .../test_error.gd` run 6/6 passed). R1-1 is `spec`, not `test evidence`, so its `fixed` result does not depend on that restore
- `_logged_ids` (client/godot/core/requirement_core/requirement_core.gd:197-198) adds a key in `evaluate`. It is reached from frame code only if a watch callback (content code) calls `evaluate` with an ID that is not in the table during `_run_batch`; whether a content callback counts as "the core functions these call" of `## frame code` was not judged. The code is outside the changed range and unchanged by it
- Only the changed lines, `init`, `release`, `_reset`, `_self_judge`, `_entry_of` and the new and changed tests were read in this round
