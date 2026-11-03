# NoticeCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/notice_core/notice_core.gd:601: medium `test evidence`: "Back input does not close it" (`open-game-works-core/skills/client-core/modules/notice-core.md`, `### maintenance notice`) has no `NoticeCore` test. No file under `client/godot/core/notice_core/tests/` reads `back_button` or sends back input, so changing this line to `param.back_button = 0` fails no test. This existed before the range: `client/godot/core/notice_core/` last changed in 301b3dd, an ancestor of the range start.
- client/godot/core/notice_core/notice_core_node.gd:57: medium `test evidence`: `cancel()` of the default image downloaders has no test while a download is in progress, although the type table says it ends a `download` with `Cancelled` and `release` and the time limit depend on it. The `cancel_count` asserts in `client/godot/core/notice_core/tests/test_image.gd:121` and `client/godot/core/notice_core/tests/test_lifecycle.gd:86` use `tests/support/hanging_image_downloader.gd`, whose `cancel` only counts, so `http_cancel` here and `cancel` at `client/godot/core/notice_core/web_image_downloader.gd:67` are not exercised that way. This existed before the range.

## debt

none

## must fix

none

## unknown

- The Godot core tests of `NoticeCore` were not run, on the desktop or the web target. `client/godot/core/notice_core/` has no change in the range, and among its dependencies only `LocalizationCore` changed: `list_languages` takes `PackedInt32Array` now, and `NoticeCore` calls only `get_language_code`. The compile and run of that module on this commit therefore rest on the core test run of `ogw review run`, not on this review.
- The range was read for `NoticeCore` only: `tools/data-tool/src/checks/NoticeCore.ts`, `tools/data-tool/tests/notice-core-check.test.ts`, the `tools/data-tool/src/corespec.ts` table closure, and the generated settings and `core-spec/` changes. The other modules changed in the range were not reviewed.
- The new check was run in a temporary copy of the data tool: `tests/notice-core-check.test.ts` passes, and with the `persist` condition disabled its first test fails. With `core-spec/` of this commit and `test-data/data`, `[badge_notice]` with `persist` `true` gives one `out_of_range` line and `false` gives none. `tests/corespec.test.ts`, `tests/coredata.test.ts`, `tests/godot.test.ts` and `tests/chat-core-check.test.ts` also pass, except `both tools keep the same Godot name lists`, which failed with ENOENT because the copy left out `tools/contract-tool`. That test was not run against the real file.
- The whole `NoticeCore` code was read, but the range review does not re-audit it: `## test` items of the spec other than the two lines in `## out of scope` were not compared with the tests one by one in this round.
- `records/review-debt/NoticeCore.json` D1 (no data check for `[notice_badge]` `persist`) is not in input `## debt`, so this round gives it no result and it stays in the list. `tools/data-tool/src/checks/NoticeCore.ts`, added in 3b8c492 within the range, does what D1 asks for, so a debt review would be expected to answer it `fixed`.
