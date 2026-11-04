# review GameUpdateCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/game_update_core/game_update_core.gd:630-631` now gives `_FAILURE_DOWNLOAD` for an `http_status` other than 0 and 200 before the `TOO_LARGE` check at `:632`, so a 503 over max bytes from `game_update_core_node.gd:86-88` (`RESULT_BODY_SIZE_LIMIT_EXCEEDED` with the code) or from `web_update_downloader.gd` `L<status>` (`_read_reply` `"L"` branch) is `[game_update_download_failed]`. A 200 over max bytes still reaches `:632` and stays `[game_update_invalid_file]` (`tests/test_signature.gd` `test_signature_file_over_its_max_bytes_is_invalid_file`). New tests: `tests/test_signature.gd:42` (fake downloader, deploy list answers 503 with a body of max bytes + 1, expects `[game_update_download_failed]`, no signature download, retry succeeds) and `tests/test_redirect.gd:28` (loopback server, `.sig` answers 503 with an HTML body over `signatureMaxBytes`, default runtime downloader). `ogw core test godot GameUpdateCore` and the same with `--web` both pass in this checkout |
| R1-2 | fixed | The `_store_opener` replacement, which returned before the platform branch, is gone. `_redirect_to_store` (`game_update_core.gd:431-442`) now always runs the platform branch; only the OS calls are replaced below it: `_url_opener` instead of `OS.shell_open` (`:440`) and `_page_script_runner` instead of `JavaScriptBridge.eval` inside `_run_page_script` (`:447-454`). In the browser run the test runner (`tests/support/game_update_test_case.gd:276-289`) runs the module's own `_ASSIGN_PAGE_SCRIPT` with the real `JavaScriptBridge.eval` against a stub `window`, so the URL recorded is the one the module's script passed to `window.location.assign`. `tests/test_app_version.gd:153` checks the URL arrives unchanged (with `"`, `'`, `\`, `&`, `é`) and that the page script ran only on `Web` (removing the web branch makes `page_redirects` 0 in the `--web` run). `tests/test_app_version.gd:172` checks the error log when `shell_open` returns `ERR_CANT_OPEN` natively or `assign` throws in the browser. `tests/test_lifecycle.gd:65-66` checks `release` clears both replacements (`game_update_core.gd:250-251`). No other module referenced `_store_opener` (grep of `client/` and `benchmark/`) |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: `game_update_core.gd:630-631` checks the HTTP status first, covered by `tests/test_signature.gd:42` and `tests/test_redirect.gd:28` in the native and `--web` runs |
| D2 | fixed | none | Same as R1-2: both spec behaviors (move the page to `store_url` on `web`, error log when the URL cannot be opened) now go through the real platform branch in core tests, `tests/test_app_version.gd:153`, `:172` |

## must fix

none

## unknown

- I did not put the defects back in a temporary copy to check that the new tests fail. Neither R1-1 nor R1-2 is a `test evidence` finding, and the core agent report says both new R1-1 tests failed natively with the old check order. My judgement of R1-2 comes from reading the assertions
- The real `OS.shell_open` and the real `window.location.assign` are still not called in core tests, because they would open the host browser or move the test page away. The tests check what the module passes to those calls and how it reads their result. The module's own `JavaScriptBridge.eval` line in `_run_page_script` (`game_update_core.gd:449`) is replaced in tests, because the test runner calls `JavaScriptBridge.eval` itself
- The commit range has changes to other modules (for example `bootstrap_core.gd` `_find_boot_entry_scene`). None of them call `GameUpdateCore`, so I did not review them
- I did not run `ogw core test` for the dependent modules (`BootstrapCore`, `QACore`, `UnitTestCore`). The core agent report says they passed
