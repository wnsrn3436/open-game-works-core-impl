# update core: UnitTestCore test time limit

## done

- `settings/core-settings.json`: `UnitTestCore.testTimeLimitMs` 60000 → 10000, written with `ogw settings set core` (the default a game gets). `core-settings.schema.json` unchanged (range `minimum: 0` still holds; no settings constraint names the key)
- `test-data/settings.json`: added `core` `{"UnitTestCore.testTimeLimitMs": 30000}`. `ogw core test` merges the core test data's game settings `core` over `core-settings.json` when it writes the core project core settings file (`coreSettingsFile` in harness `tools/src/commands/generate/api.ts`), so core's own tests run with 30000
- `client/godot/generated/core_settings.json`: the generated file `ogw core test` rewrote, now `UnitTestCore.testTimeLimitMs` 30000. Committed separately (307c454) because the worktree run does not commit generated files
- No spec, API, hook, event or core settings key change. No test change: `test_lifecycle.gd` compares the module's limit against `CoreSettings`, not a literal, and no core test hard-codes 60000 as the test limit
- Core tests on the final commit 307c454, all client modules: `ogw core test godot` 2999/2999 pass, `ogw core test godot --web` 2972/2972 pass. `ogw core dependents UnitTestCore` lists only `UnitTestCore`, but the test-data change alters the core settings file every client test reads, so all modules ran. `ogw code check core`: type check, lint, dependency, secret pass

## spec proposals

none

## review

none

## unverified

- Whether the native run included the render pass: the output has no `skipped` line and no render-pass line, so I could not tell from it whether a render pass ran
- The 30000 margin rests on the proposal's numbers (longest core test 6682 ms; render pass not measured). This run did not measure per-test durations
- The 10000 game default rests on the proposal's game regression measurements (longest of 3813 passing tests 504 ms). No game was run here
