# NoticeCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test `client/godot/core/notice_core/tests/test_maintenance.gd:24` `test_back_input_does_not_close_the_maintenance_popup` opens the maintenance popup through `wait_maintenance_clear`, sends an escape key press and release through `InputCoreDev.inject_device_input` (`press_back`, line 44), and asserts popup count 1, `waiting.done` false and request count 1. I restored the defect in a temporary detached worktree of HEAD (`git worktree add --detach` under `worktrees/_core/`, removed afterwards) by changing `param.back_button = -1` to `param.back_button = 0` at `client/godot/core/notice_core/notice_core.gd:601`. `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_maintenance.gd` failed: `test_back_input_does_not_close_the_maintenance_popup: [0] expected to equal [1]: back input does not close the popup; [2] expected to equal [1]: no fetch after back input`. No other test of the file failed |
| R1-2 | fixed | New test `client/godot/core/notice_core/tests/test_image.gd:112` `test_cancel_ends_a_download_of_the_default_downloader` starts `download` of `NoticeCore._downloader` against a loopback HTTP response, calls `cancel()` in the same frame, and asserts that the download ends with `CANCELLED` and an empty body, that no `HTTPRequest` child is left, and that a second `download` returns `DONE` with the PNG body. Restored in two temporary detached worktrees of HEAD (removed afterwards). (a) Native: replaced `_finish_http(result)` in `http_cancel` (`client/godot/core/notice_core/notice_core_node.gd:63`) with `pass`. `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_image.gd` failed with `cancel() ends the download`, `[1] expected to equal [0]: the request is freed`, `[1] expected to equal [0]: a download after the cancel` and the empty body mismatch. (b) Browser: replaced `_finish(result)` in `cancel` (`client/godot/core/notice_core/web_image_downloader.gd:73`) with `pass`. `ogw core test godot NoticeCore --web` failed only in this test: `[1] expected to equal [3]`. The page entry deleted by `_CANCEL` makes the next `_poll` end the download with `CONNECTION_FAILED` instead of `CANCELLED` |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | `test_maintenance.gd:24` now sends back input to the maintenance popup. With `param.back_button = 0` restored at `notice_core.gd:601`, that test fails (see R1-1) |
| D3 | fixed | none | `test_image.gd:112` now runs `cancel()` of the default downloader while a download is in progress. Restoring the defect in `http_cancel` (native) or in the web `cancel` (`--web`) makes that test fail (see R1-2) |

## must fix

none

## unknown

- In the commit range, only `client/godot/core/notice_core/tests/test_image.gd` and `client/godot/core/notice_core/tests/test_maintenance.gd` changed under `notice_core/`, and NoticeCore implementation files did not change. Of the dependency modules, `BadgeCore` (`load_saved` save-pending decision, `_is_decimal` limit) and `BootstrapCore` (boot entry scene, release trace) changed in the range. I read those diffs: they do not change `BadgeCore.set_item` and `clear_item`, which NoticeCore calls, or any behavior NoticeCore relies on. NoticeCore was not reviewed again beyond that
- I did not run the unmutated suites (native and `--web`) myself. Each run on a mutated copy reported only the new test as failing, and the core agent report says the unmutated `ogw core test godot` runs passed in both modes
