# review BootstrapCore round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/web/ogw-shell.html:177 | Changed definition: `open-game-works-core/skills/client-core/engines/godot.md:121` now reads the launch value file only "in the browser runtime of a DEV export", a DEV export being one whose page sets `window.ogwDevExport` to `true`, and "In an STG or PROD export the shell ignores that parameter, and a page with it starts as one without it". The harness side gives the marker (`open-game-works-core/tools/src/lib/godot-web.ts:22,26` puts `<script>window.ogwDevExport = true;</script>` into `html/head_include` of DEV only, and the shell expands `$GODOT_HEAD_INCLUDE` at line 103 before its script at line 121). But no commit of the range changes the shell: `preloadLaunchValues` still reads `ogw_launch_values` with no check of `window.ogwDevExport` (lines 177-196), and the shell has no reference to `ogwDevExport`. Run path: open an STG or PROD Web export (no head include, so `window.ogwDevExport` is undefined) at `<page>?ogw_launch_values=x` or `?ogw_launch_values=/missing.json` (HTTP 404): line 188 or 192 rejects, `engine.startGame` is not called and line 257 shows the failure notice, where the definition says the page starts as one without the parameter. With an existing same-origin JSON file, the PROD engine is started with `--launch-values=` added, which the definition also excludes | In `preloadLaunchValues`, return `Promise.resolve([])` when `window.ogwDevExport !== true` before reading the parameter, and add a test (harness shell test or core `--web` run) where a page without the marker and with an invalid `ogw_launch_values` starts the engine | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | The definition is now settled (`open-game-works-core/skills/client-core/engines/godot.md:121`), but the commit range changes no file under `client/godot/core/web/` or `client/godot/core/bootstrap_core/`, and `client/godot/core/web/ogw-shell.html:177` still reads `ogw_launch_values` in every export; written again in `## findings` as R1-1 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range 47e03f23..e482643d changes, outside the records, only InputCore, QACore tests and test resources, and the core settings schema (`InputCore` pad axis sensitivity limit). BootstrapCore calls only `init`/`release` of those modules and reads no changed settings key, so no BootstrapCore behavior is reached by those changes
- The core tests of BootstrapCore (native and `--web`) were not run: no code of the target changed in the range, and the open finding is read directly from the shell code against the changed definition
- Whether the harness tool tests (`open-game-works-core/tools/test/lib/godot-web.test.ts`) check that only DEV presets get the head include is harness tool behavior outside this target and was not checked
