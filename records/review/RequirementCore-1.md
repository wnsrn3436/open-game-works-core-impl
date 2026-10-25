# review RequirementCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/requirement_core/requirement_core.gd:383 | `engines/godot.md` `## frame code` forbids adding a `Dictionary` key in frame code, and its log exception covers only building the log message. `_self_judge` :383 runs `_logged_types[type] = true` on the first self judgement of a type without a judge hook. Frame code reaches it: `requirement_core_node.gd:23` `_process` → `_on_frame` :803 (calls `_run_batch` :817) → `_run_batch` :852 → `_evaluate_entry` :308 → `_judge` :336/:359 → `_self_judge` :383. Run path: content code watches an `All` condition whose first child fails and whose second child has a type with no judge hook; `watch` :258 stops at the first child, so `_self_judge` of that type is not reached outside frame code and `_logged_types` has no key for it. A trigger of the first child's kind is raised after that child passes; the next `_process` judges the second child and adds the key in frame code. (The `%` messages at :384, :388, :829, :858 are `LogCore.log_error` messages built only on the path that writes them, which `## frame code` allows since harness commit faf984c.) | Keep the logged flags in a collection whose size does not change in frame code: e.g. fill `_logged_types` in `init` with a `false` value for every `GameData.RequirementType` value and test the value instead of `has`, or use a `PackedByteArray` sized in `init` and indexed by the position of the type value; update `test_lifecycle.gd:70`, which asserts `_logged_types.size()` 0 after `release` | no | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D4 | open | R1-1 | Same problem as D5 at the line numbers before the lines moved (`_self_judge` is now :379, `_run_batch` :823). The `%` log message part is not a problem now: `engines/godot.md` `## frame code` lets frame code build the message of a `LogCore.log_error` call on a path that runs only when that log is written, and each of :384, :388, :829, :858 builds its message only as the argument of a `log_error` call that runs on that path. The `Dictionary` key add `_logged_types[type] = true` at :383 remains in frame code (R1-1) |
| D5 | open | R1-1 | The `%` messages at :384, :388, :829, :858 are within the log message exception of `engines/godot.md` `## frame code` (each is built only as the argument of a `LogCore.log_error` call on the path that writes it). The `Dictionary` key add `_logged_types[type] = true` at :383, which frame code reaches through `_run_batch` :852 → `_evaluate_entry` → `_judge` → `_self_judge`, remains (R1-1) |

## must fix

none

## unknown

- The commit range is empty (`1f67b4e..1f67b4e`), so no changed code was reviewed; only the positions of D4 and D5 and the frame code path from `requirement_core_node.gd` `_process` through `_on_frame`, `_run_batch`, `_evaluate_entry`, `_judge`, `_self_judge`, `_call_judge`, `_guide_of`, `_is_cache_valid`, `_remove_watch_at` were read
- Core tests were not run; R1-1 is from reading the code path, not from a run
