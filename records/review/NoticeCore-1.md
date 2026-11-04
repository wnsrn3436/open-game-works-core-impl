# NoticeCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/notice_core/notice_core.gd:601 | Spec `open-game-works-core/skills/client-core/modules/notice-core.md:79` says "Back input does not close it" for the maintenance popup. `param.back_button = -1` here has no `NoticeCore` test: `grep -rn "back" client/godot/core/notice_core/tests/` finds only `background` in `test_fetch.gd`, and no test sends back input while the maintenance popup is open or reads the `back_button` of its param. `test_maintenance.gd` closes the popup only with `press(ReservedString.notice_retry())` and `UICore.close_all_popups()`. Changing the line to `param.back_button = 0` passes the `UICore` param check (`client/godot/core/ui_core/ui_core.gd:1768`, one button) and leaves every assert of `test_maintenance.gd` unchanged, so a back input could close the maintenance popup with no test failing. (Input debt D2.) | Add a `test_maintenance.gd` test that opens the maintenance popup through `wait_maintenance_clear`, sends back input through `UICore` (the path `client/godot/core/ui_core/ui_core.gd:1834` reads), and asserts that the popup count stays 1, `waiting.done` stays `false` and no new `GetNotices` request is sent | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/notice_core/notice_core_node.gd:57 | Spec type table (`notice-core.md`, image downloader row) says `cancel()` ends a `download` in progress with `Cancelled`, and the time limit (`notice_core.gd:497`) and `release` (`notice_core.gd:329`) rely on it. The only cancel asserts (`client/godot/core/notice_core/tests/test_image.gd:121`, `client/godot/core/notice_core/tests/test_lifecycle.gd:86`) use `tests/support/hanging_image_downloader.gd`, whose `cancel` only counts. `test_image.gd:65` runs the default downloader (`http_image_downloader.gd` or `web_image_downloader.gd`) only for downloads that end by themselves. So neither `http_cancel` here (cancel_request, the `CANCELLED` result, freeing the request, emitting `http_finished`) nor `cancel` at `client/godot/core/notice_core/web_image_downloader.gd:67` is run while a download is in progress; removing `_finish_http(result)` from `http_cancel` would leave `download` waiting forever and no test fails. (Input debt D3.) | Add a test that starts `download` of the default downloader against a loopback HTTP response that does not finish (or calls `cancel()` before the response arrives), calls `cancel()`, and asserts that `download` returns `CANCELLED` with an empty body and that a second `download` afterwards succeeds | no | 88 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R1-1 | `notice_core.gd:601` is still `param.back_button = -1`, and no file under `client/godot/core/notice_core/tests/` sends back input or reads `back_button` |
| D3 | open | R1-2 | `http_cancel` (`notice_core_node.gd:57`) and `web_image_downloader.gd:67` `cancel` are still not reached by any test; the cancel asserts use only `hanging_image_downloader.gd` |

## must fix

none

## unknown

- The commit range `72e3a2d..72e3a2d` is empty, so no changed code was reviewed; the review covered only the input `## debt` items.
- The tests were not run. D2 and D3 were judged by reading the tests and grepping for back input and cancel calls, not by restoring the defects and running the suite.
- The `web_image_downloader.gd` path can only run in the browser runtime, and it was checked only by reading.
