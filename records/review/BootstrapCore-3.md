# review BootstrapCore round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/web/ogw-shell.html:180-182`: `preloadLaunchValues` now returns `Promise.resolve([])` when `window.ogwDevExport !== true`, before it reads `ogw_launch_values`, so a page without the DEV marker reads no file, adds no `--launch-values=` user argument and starts the engine (line 255), as `open-game-works-core/skills/client-core/engines/godot.md:121` sets. The DEV path (same-origin check, fetch failure rejection, preload, user argument) is unchanged. Test `client/godot/core/bootstrap_core/tests/test_web_shell_launch_values.gd` takes the shell code between the `ogw:launch-values` markers from the served page and runs it with no marker, marker `false` and marker `"true"`. `ogw core test godot BootstrapCore --web` passes on HEAD 02f297a9. Restored the defect in a temporary `git worktree add --detach` of HEAD by deleting the three guard lines: `ogw core test godot BootstrapCore --web` fails at `test_export_without_the_marker_ignores_the_launch_value_parameter` (got the rejection for `x`, the HTTP 404 rejection and `--launch-values=/tmp/ogw_launch_values.json` for the three `/values.json` cases, where `\|\|0\|0` was expected) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Outside the records, the commit range changes in the client only the web shell, the new BootstrapCore test, LocalizationCore font weight code and tests, QACore `qa_query.gd` and its font weight test, and the core settings value `item-ledger.historyRetentionMs` (a server key BootstrapCore does not read). BootstrapCore calls only `init`/`release` of LocalizationCore and QACore, and those signatures did not change, so no BootstrapCore behavior is reached by those changes. The server changes are outside this client target
- No real STG or PROD Web export page was opened: the browser run of `ogw core test` makes only a DEV export, so the test runs the shell's `preloadLaunchValues` with stand-in `window`, `fetch` and `engine`. That the harness tool puts the `html/head_include` marker only into DEV presets (`open-game-works-core/tools/src/lib/godot-web.ts`) is harness tool behavior outside this target and was not checked
- The native run of `ogw core test godot BootstrapCore` was not run in this review; the new test returns at once on a native run (skip through `UnitTestCore.require_platform`)
