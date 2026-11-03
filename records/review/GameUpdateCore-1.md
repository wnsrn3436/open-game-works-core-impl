## findings

none

## previous

none

## out of scope

- client/godot/core/game_update_core/game_update_core.gd:612: medium `_download_failure` checks `TOO_LARGE` before the HTTP status, so a non-200 response whose body is over max bytes is `[game_update_invalid_file]`, while `### fetch failure` of the spec sets `[game_update_download_failed]` for an HTTP status other than 200. The spec table also lists max bytes exceeded and does not set which row wins, so the fix is to check the status first or to set the order in the spec. Reproduced on Godot 4.7.2: `HTTPRequest` with `body_size_limit` 1024 against a loopback server answering 503 with a 4096-byte body ends with `RESULT_BODY_SIZE_LIMIT_EXCEEDED` and code 503, and `game_update_core_node.gd:86` turns that into `TOO_LARGE` with `http_status` 503. So a proxy or CDN error page over `GameUpdateCore.signatureMaxBytes` (1024) on the `.sig` URL tells the user the file is invalid. The web downloader does the same: its `Content-Length` check gives `L<status>` for any status (`web_update_downloader.gd:19`). No test sends `TOO_LARGE` with a status other than 200. This existed before the range and is unrelated to its changes
- client/godot/core/game_update_core/game_update_core.gd:429: medium The real store redirect has no test, which is a `spec` problem. Every test sets `_store_opener` (`tests/support/game_update_test_case.gd:66`, `:88`), so `_redirect_to_store` returns before `window.location.assign` (line 433) and `OS.shell_open` (line 435) in all core tests. Two behaviors of the spec therefore have no test: on `web` the current page moves to `store_url`, and when the URL cannot be opened an error log is left. A grep of `tests/` finds no reference to `location.assign`, `shell_open` or the log text. This existed before the range and is unrelated to its changes
- client/godot/core/game_update_core/game_update_core.gd:47: medium Code used only by core tests is outside `dev/`, which is a `structure` problem at the DEV code boundary. `_store_opener`, `_file_hasher` and `_file_writer` (lines 47, 50, 51) are test replacements, branched on at lines 429, 502 and 523 of the code that ships in STG and PROD builds. The tests set them directly as private variables, and spec `## DEV` lists only `set_downloader`. Nothing in a build without DEV code sets them, so they change no result there. This existed before the range and is unrelated to its changes

## debt

none

## must fix

none

## unknown

- GameUpdateCore has no change in the commit range. No file under `client/godot/core/game_update_core/` changed, and neither did `core-spec/GameUpdateCore.json`. I read the range's changes that could reach it: the `LocalizationCore.list_languages` signature, the `MessageCore.show_black_box` signature, `client/godot/generated/core_settings*.json` and the `requirement` and vector list changes of the data tool. GameUpdateCore does not use those operations, and its four settings keys are unchanged. `ogw core test godot GameUpdateCore` passed on this checkout
- `ogw core test godot GameUpdateCore --web` was not run, so the browser runtime paths (`web_update_downloader.gd`, the `web` store redirect) were checked by reading only
- The store redirect was not run on a device or in a browser, and `OS.shell_open` failure was not reproduced
- `is_data_version` was checked only against its own code comment. The spec refers to `## data version` of the `data` skill, which is not a defining document of this review and was not read
- The system popup flow of `UICore` was read only for `open_system_popup`, `close_popup` and `_on_system_button`. The case of `close_all_popups` running during a popup open flow was not checked
- The frame cost of signature verification was measured on this desktop host only: SHA-512 of 16 KiB took 12 ms, of 1 MiB took 788 ms, and one verify of a short message took 122 ms. It was not measured on a phone or in a browser
