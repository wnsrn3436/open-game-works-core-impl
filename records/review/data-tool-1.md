# review data-tool round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `spec` | medium | tools/data-tool/src/corespec.ts:199 | `core-spec/validation.json` got `usedTables: ["requirement"]` in this range. `addTableClosure` returns early for `requirement`, so that table never enters `data.tables`, and the enum loop at `corespec.ts:239` does not add the enums of its header. `skills/data/SKILL.md:208` puts the elements of the enums of a used table's header in core data even when the owning module is not used, and only the `requirement` file is exempt (`SKILL.md:211`). Reproduced with the data tool, using `core-spec` of HEAD and `--modules ["validation"]`: `data/enums.csv` gets `BannedWordMatch` rows and no `RequirementLogic` rows. With `--modules ["RequirementCore"]` it gets `RequirementLogic,All,1` and `RequirementLogic,Any,2`. With `--modules ["validation"]` and those two rows written in `data/enums.csv`, the run exits 1 with `data/enums.csv:2:1 ERROR reserved_name enum RequirementLogic is a core enum of a module the game does not use` (`check-names.ts:82`). The generated enum values stay correct through the `core-spec.json` fallback (`REQUIREMENT_LOGIC_ALL = 1`, `REQUIREMENT_LOGIC_ANY = 2`), so the wrong result is limited to core data and that check | Keep the rule that no `requirement` file is made, but add the enums of the `requirement` header to `CoreData.enums` when a module of `--modules` has `requirement` in `usedTables`. Add a test with `--modules ["validation"]` that expects the `RequirementLogic` rows in `data/enums.csv` | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- `tests/registry.test.ts` and `tests/registry-processes.test.ts`: in a temporary copy of HEAD, the full run had 4 failures in these two files. A second run of only `cli.test.ts` and these two files also had 4 failures, and the failing tests were not all the same. The failures were time limits (`Test timed out in 60000ms`, `expected 7675 to be less than 5000`, `expected 6198 to be less than 5000`), one failed `expect(false).toBe(true)`, and one `held did not come`. The range does not change the registry code. The load average during the checks was above 23, but load was not confirmed as the cause and these tests were not run on an idle machine
- `tests/cli.test.ts`: it failed in the first full run only because the temporary copy had no `bin/data-tool.js`. It passed after `npm run build`
- The other test files of `tools/data-tool`, including `tests/godot.test.ts` and `tests/notice-core-check.test.ts`, passed in the full run
- The GUT file `tools/tests/godot/test_data_round_trip.gd` was not run, because that needs the harness project setup of `ogw core test tools`. In its place, the data tool was run on a copy of `tools/tests/game/` with all modules of `core-spec/`, and the generated `game_data.gd`, `game_setting.gd` and `game_data_dev.gd` were run headless on Godot 4.7.2 with a temporary script. `load_tables` returned `true`. `points2`, `points3` and `points4` of `[tool_test_a]` held the expected values and those of `[tool_test_b]` were empty. `GameSetting.tool_test_points()` returned a `PackedVector2Array`, and the `GameDataDev` test value applied and cleared
- Games in `games/` were not read. A content file that declares `Array[Vector2]`, `Array[Vector3]` or `Array[Vector4]` for an `array<vector<float>>` column would need that type changed after the core upgrade. `core-spec/`, `test-data/data/` and `benchmark/*/data/` have no such column
- Server generated code for `array<vector<float>>` columns has no new test in this range and was not run. The range does not change `tsgen.ts`
