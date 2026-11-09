# review NoticeCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | Commit 221e4c26 removes the `LogCore.release()` in the middle of `test_release_before_init_drops_the_image_downloader`, which now ends at `client/godot/core/notice_core/tests/test_lifecycle.gd:154` after the `errors()`/`warns()` checks, and moves the `start()` and image part into the new `test_downloader_dropped_before_init_is_not_used_by_a_later_init` (`:157`), which does not call `LogCore.init()` before `start()`, so the `UnitTestCore` log collector stays registered for the whole test. Restored the defect in a temporary worktree (`git worktree add --detach` at 81375b8f) by adding `LogCore.log_error(_TAG, "unexpected init error")` before `_is_initialized = true` in `NoticeCore.init` (`client/godot/core/notice_core/notice_core.gd:122`); `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_lifecycle.gd` now also fails `test_downloader_dropped_before_init_is_not_used_by_a_later_init` with `unchecked error logs: NoticeCore: unexpected init error` (in round 3 the same mutation let the merged test pass). The unmutated file passes on 81375b8f |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only change of the commit range under `client/godot/core/notice_core/` is `client/godot/core/notice_core/tests/test_lifecycle.gd:144`-`:178`; NoticeCore module code did not change in the range and was not reviewed again. The AuthCore changes and the review records of the range belong to other targets and were not reviewed
- Only `test_lifecycle.gd` was run (headless), on the mutated copy and on the unmutated commit; the whole NoticeCore suite and the `--web` run were not run in this review
