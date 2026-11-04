## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/notice_core/notice_core.gd:601 | `open-game-works-core/skills/client-core/modules/notice-core.md:79` says that back input does not close the maintenance popup. No test sends back input to that popup. `client/godot/core/notice_core/tests/` has no `press_back`, `press_key` or `back_button`, and `test_maintenance.gd` closes the popup only with `press` of the button and `UICore.close_all_popups`. `client/godot/core/bootstrap_core/tests/` also has no back input, and `test_boot_order.gd:123` only reads the call trace of `wait_maintenance_clear`. `client/godot/core/ui_core/tests/test_system_popup.gd:30` tests `UICore` with a popup it makes itself. Run path: change this line to `param.back_button = 0`. `UICore._system_back` (`client/godot/core/ui_core/ui_core.gd:1833`) then presses `[notice_retry]` on back input, the popup closes and `wait_maintenance_clear` fetches again. No assert of a test reads this path, so no test fails. | Add a test to `test_maintenance.gd`: with `maintenance` `true`, send back input (as `press_back` of `ui_test_case.gd:385` does, `KEY_ESCAPE`) to the open maintenance popup, then assert that `UICore.get_open_popup_count()` stays 1, `request_count()` stays 1 and `wait_maintenance_clear` has not returned. The test must fail with `param.back_button = 0` at this line. | no | 95 |
| R1-2 | test evidence | medium | client/godot/core/notice_core/notice_core_node.gd:57 | The type table at `open-game-works-core/skills/client-core/modules/notice-core.md:45` says that `cancel()` ends a `download` in progress with `Cancelled`, and `## release` and the time limit (`notice-core.md:88`, `notice-core.md:94`) depend on it. `http_cancel` here and `cancel` at `client/godot/core/notice_core/web_image_downloader.gd:67` are not run by a test while a download is in progress. The only `cancel` asserts, `client/godot/core/notice_core/tests/test_image.gd:121` and `client/godot/core/notice_core/tests/test_lifecycle.gd:86`, use `tests/support/hanging_image_downloader.gd:22`, whose `cancel` only counts. The tests that use the default downloader (`test_image.gd:26`, `test_image.gd:65`, `test_image.gd:130`, `test_image.gd:155`) wait for each `download` to end and do not call `cancel`, and no other module's test calls `NoticeCore.load_image`. Run path: make `http_cancel` return at its first line, or make `cancel` of the web downloader do nothing. A running `download` of the default downloader then never ends with `Cancelled`, and no assert of a test reads this. | Add a test that starts `download` of the default downloader (`NoticeCore._downloader`) against the loopback HTTP server, calls `cancel()` in the same frame, and asserts that `download` has ended with `CANCELLED` and ends only once. `test_cancel_ends_the_download_once` at `client/godot/core/game_update_core/tests/test_web_downloader.gd:73` has this pattern for the web downloader of `GameUpdateCore`. It must run in both the native run and the browser run, so that both `http_cancel` and the web `cancel` are reached. | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Commit 3b8c492, which HEAD contains, added `tools/data-tool/src/checks/NoticeCore.ts:21`, which reports `out_of_range` for a `[notice_badge]` badge row with `persist` `true`, and `tools/data-tool/tests/notice-core-check.test.ts:31`, which expects that ERROR line and exit code 1. `src/checks/` files are collected through `virtual:module-checks` (`tools/data-tool/src/module-check.ts:6`), so the file needs no other registration. `core-spec/NoticeCore.json` still has `"invariants": []`, as `core-spec/ChatCore.json` does for the same rule, so that value is not part of this problem. Run in a scratch copy of `tools/data-tool`: `vitest run tests/notice-core-check.test.ts` gave 3 passed. With `src/checks/NoticeCore.ts` removed, `the [notice_badge] badge row with persist true is an ERROR` failed and the other 2 passed. `test-data/data/tables/badge.csv:6` has `persist` `false` for the row `[badge_notice]` that `[notice_badge]` points to. |
| D2 | open | R1-1 | The problem remains at `client/godot/core/notice_core/notice_core.gd:601`. See R1-1. Severity stays `medium`. |
| D3 | open | R1-2 | The problem remains at `client/godot/core/notice_core/notice_core_node.gd:57` and `client/godot/core/notice_core/web_image_downloader.gd:67`. See R1-2. Severity stays `medium`. |

## must fix

none

## unknown

- The commit range is empty (`f400b97..f400b97`), so this round covered the input `## debt` items and no changed code. It is not a review of the whole target
- The Godot core tests of `NoticeCore` were not run, native or browser. R1-1 and R1-2 come from reading the code and searching the tests of `client/godot/core/`. The run paths in them (changing `notice_core.gd:601`, disabling the two `cancel` paths) were not run on a restored copy
- Only the D1 test file of the data tool was run, not the whole data tool suite
- Not read: `client/godot/core/notice_core/tests/test_active.gd`, `test_badge.gd`, `test_fetch.gd`, `test_read_state.gd`, except for the search for back input and `cancel` over that folder
- Not read: `client/godot/core/notice_core/notice_core.gd` lines 1 to 124 (constants, `init`) and lines 276 to 284
- Not read: the defining documents `log-core.md`, `event-core.md`, `time-core.md`, `local-data-core.md`, `localization-core.md`, `network-core.md`, `ui-core.md`, `badge-core.md`, `server-core/modules/notice.md`, `core/SKILL.md`, `client-core/SKILL.md`. Of `godot.md`, only the `NoticeCore` row (line 411) was read. Of `command.md`, only lines 100 to 150 were read
- `## out of scope` is `none` for the code that was read. Code that was not read was not judged
