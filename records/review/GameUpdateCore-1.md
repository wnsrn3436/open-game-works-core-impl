# review GameUpdateCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/game_update_core/game_update_core.gd:612 | Open debt D1. `_download_failure` returns `_FAILURE_INVALID` for any `DownloadStatus.TOO_LARGE` before it looks at `http_status`. `game_update_core_node.gd:86-88` maps `RESULT_BODY_SIZE_LIMIT_EXCEEDED` to `TOO_LARGE` with the response code, and the web downloader gives `L<status>` for any status (`web_update_downloader.gd:19`, `:21`, `:24`, read at `:121-123`). Run path: the `.sig` URL answers 503 with a body over `GameUpdateCore.signatureMaxBytes` (e.g. a CDN error page) → result `TOO_LARGE`, `http_status` 503 → `[game_update_invalid_file]`, while spec `### fetch failure` sets `[game_update_download_failed]` for an HTTP status other than 200. The fake downloader already produces this result (`tests/support/fake_update_downloader.gd:91-93` keeps `response.http_status`), but no test sends a non-200 response over max bytes | In `_download_failure`, give `_FAILURE_DOWNLOAD` when `http_status` is neither 0 nor 200 before the `TOO_LARGE` check, and add a test with a 503 response over max bytes that expects `[game_update_download_failed]`. Or, when the spec owner prefers, state the row order in `### fetch failure` | no | 85 |
| R1-2 | spec | medium | client/godot/core/game_update_core/game_update_core.gd:429 | Open debt D2. Every test case sets `GameUpdateCore._store_opener` (`tests/support/game_update_test_case.gd:66`, `:88`), so `_redirect_to_store` returns at line 430 in all core tests and lines 432-436 never run. Two behaviors of spec `### check_update` store redirect therefore have no test: on `web` the current page moves to `store_url` (`JavaScriptBridge.eval` of `window.location.assign`, line 433), and when the URL cannot be opened an error log is left (line 435-436). `tests/` has no reference to `location.assign`, `shell_open` or `could not open the store URL`; the store tests (`tests/test_app_version.gd:19`, `:72`) only check the URL handed to the replacement | Test the real redirect path: a browser-run test that checks `window.location.assign` receives `store_url` (e.g. by stubbing it in the page) and a native test where opening fails and the error log is collected, or route the OS call through a replacement that sits below the platform branch so both branches run in core tests | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `game_update_core.gd:612-613` still checks `TOO_LARGE` before the HTTP status; `game_update_core_node.gd:86-88` and `web_update_downloader.gd:19` still keep the non-200 status on a `TOO_LARGE` result; no test covers it |
| D2 | open | R1-2 | `game_update_core.gd:429-436` and `tests/support/game_update_test_case.gd:66`, `:88` unchanged; no test reaches the web branch or the failure log |
| D3 | withdrawn | none | The engine rules sanction this shape. `client-core/engines/godot.md:529` keeps module state used by test replacements in a `static var` starting with `_` of the module class, and `godot.md:157` allows that module's core tests to use `_` names. Neither `godot.md` `## DEV code` (`:526-537`) nor `godot.md:531` requires every such var to be set through a `<Module>Dev` operation; the rule is that core code outside `dev/` references no `class_name` or path under `dev/`, which `_store_opener`, `_file_hasher` and `_file_writer` (`game_update_core.gd:47-51`) do not. Other modules use the same pattern (e.g. `auth_core/auth_core.gd:97` `_test_url_opener`, `time_core/time_core.gd:59-60`). The vars are reset by `release` (`game_update_core.gd:245-247`) and are empty in a build without core tests, so no build result changes |

## must fix

none

## unknown

- The commit range `e02d2bf..e02d2bf` is empty and `## spec changes` is `none`, so no changed code was reviewed and no new findings outside the debt items were looked for; the rest of the module was not re-reviewed as a whole
- D1 was checked by reading the code paths; it was not re-run on Godot in this round (the input records a reproduction on Godot 4.7.2). Core tests were not run, since no code changed in the range
- Whether a browser-run core test can observe `window.location.assign` without leaving the test page was not checked (R1-2 fix direction)
