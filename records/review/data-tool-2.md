# review data-tool round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `tools/data-tool/src/corespec.ts:196` now follows `requirement` in the `reached` set, and `tools/data-tool/src/corespec.ts:240` reads the enums of every reached header and keeps `requirement` out of `data.tables`. Run with the data tool on a copy of HEAD, using `core-spec/` of HEAD and `--modules ["validation"]`: `data/enums.csv` has `RequirementLogic,All,1` and `RequirementLogic,Any,2`, no `data/tables/requirement.csv` is made, and the second run exits 0 with no `reserved_name`, which is the rule of `open-game-works-core/skills/data/SKILL.md:208` and `:211`. The defect was restored in a temporary copy by reversing the range's diff of `corespec.ts`: the 4 cases of `requirement reached by %s` in `tests/coredata.test.ts` and `validation alone` in `tests/corespec.test.ts` all failed (`expected 'type,element,value,#comment\nBannedWo…' to contain 'RequirementLogic,All,1,\nRequirementL…'`), and they pass on HEAD. Each module of `core-spec/` was run alone with the fixed and the restored tool: only `validation` has a different `data/enums.csv`, no module has a different `data/tables/` listing, and exit codes are equal. For `--modules ["validation"]`, with and without `requirement` cells in a game table, a `--engine godot --binary` build differs between the two tools only in `data/enums.csv`; generated code and binaries are the same |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `tests/registry.test.ts` and `tests/registry-processes.test.ts`: the 4 failures written in `## unknown` of round 1 did not appear. The full run of `tools/data-tool` on a copy of HEAD passed, 39 files and 363 tests, with a load average of 66 at its end. One passing run does not show the cause of the earlier failures, and that cause was not checked. The range does not change the registry code
- The GUT file `tools/tests/godot/test_data_round_trip.gd` and `ogw core test tools data-tool` were not run. The generated Godot code was not run either. It was only compared between the fixed and the restored tool, and it is the same
- Server generated code for `array<vector<float>>` columns has no test and was not run, as in round 1. The range does not change `tsgen.ts`
- Games in `games/` were not read. A game whose modules include `validation` and whose `data/enums.csv` lacks the `RequirementLogic` rows now fails a binary build until the data tool runs without `--binary`. This was reproduced on a copy: exit 1, `the data is not matched; run the data tool without --binary and commit: data/enums.csv`. The error names the way out. Whether `ogw core upgrade` runs the data tool without `--binary` for the game was not checked, because that is outside this target. `benchmark/godot/data/enums.csv`, `test-data/data/enums.csv` and `tools/tests/game/data/enums.csv` have the rows
- The module-by-module comparison ran each module alone, not with its `## dependency` closure, and used a `core-spec.json` assembled from `core-spec/` in file name order, not the file that `ogw core release` makes
