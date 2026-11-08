# review BootstrapCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/web/ogw-shell.html:177 | `skills/client-core/modules/bootstrap-core.md:239` says STG and PROD builds have no launch value reading, but the shell of every Godot Web export (`html/custom_html_shell` is set for every Web preset in `open-game-works-core/tools/src/lib/godot-web.ts:15`, STG and PROD included) reads the query parameter `ogw_launch_values` unconditionally (line 177), fetches that same-origin path, puts it into the engine file system and adds `--launch-values=` (lines 190-196), and when the parameter is not an absolute same-origin path or the fetch fails it rejects (lines 188, 192) so `engine.startGame` is never called and the failure notice is shown (line 244 `.then(..., displayFailureNotice)`). Run path: open a PROD Web export at `<page>?ogw_launch_values=/missing.json` (HTTP 404) or `?ogw_launch_values=x`: the game does not start, although the PROD build has no DEV code that would read launch values. `skills/client-core/engines/godot.md:121` sets the shell behavior with no environment condition, so the two defining documents conflict, and the shell cannot tell a DEV export from an STG or PROD export from the values the exporter fills in | Settle in `godot.md` how the shell knows it is a DEV export (e.g. the harness tool fills a DEV-only marker or uses the launch value part of the shell only for the DEV preset), and have the shell ignore `ogw_launch_values` in STG and PROD exports, so a PROD page with that parameter starts as one without it | yes | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests of BootstrapCore (native and `--web` browser run) were not run in this review; the findings come from reading the code, the tests and the defining documents
- The shell path that rejects a non-path or unfetchable `ogw_launch_values` and the `withUserArgs` handling of exporter arguments were checked against the Godot `engine.js` behavior as read (config `args` replaced by the `startGame` override, `preloadFile` accepting an `ArrayBuffer` before `init`), not run in a browser; no core test can observe a shell that does not start the engine, and the harness tool tests of the shell (`open-game-works-core/tools/test/lib/godot-web.test.ts`) are outside this target
- Passing the random base and the frame step in the boot after an update reboot was checked only by reading: `_init_modules` calls `_pass_adapters` and so `pass_time_launch_values` in every boot, and `_has_random_base`, `_random_base`, `_frame_step_fps` are cleared only by `_shutdown`; no test boots an update reboot with these launch values, and `## test` of the spec does not require one
- Whether the check export of the harness tool writes `res://generated/launch_values.json` in the format the export reading expects is harness tool behavior and was not checked
