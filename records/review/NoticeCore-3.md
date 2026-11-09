# review NoticeCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | test evidence | medium | client/godot/core/notice_core/tests/test_lifecycle.gd:155 | The R2-1 fix (commit 29a4b168) adds `LogCore.release()` in the middle of `test_release_before_init_drops_the_image_downloader`, before `start()`. `LogCore.release` deletes the listener (`log-core.md` `set_log_listener`: "`release` deletes it"; `client/godot/core/log_core/log_core.gd:601`-`:602` in `_reset` clears `_listener` and `_test_clock`). `UnitTestCore` registers its log collector and the LogCore test clock only between tests (`client/godot/core/unit_test_core/dev/unit_test_core.gd:652`, `:745`-`:750`), and `start()` -> `_init_modules` only calls `LogCore.init()` (`client/godot/core/notice_core/tests/support/notice_test_case.gd:242`). So from `:156` to the end of the test, logs never reach `UnitTestCore._collect`, and the rule of `unit-test-core.md:115` / `:254` (a test with an unchecked error log left fails) no longer applies to the `init`, `fetch_with` and `load_image` part of the test (`:156`-`:172`). Reproduced: in a temporary worktree (`git worktree add --detach` at d8b58af1), `LogCore.log_error(_TAG, "unexpected init error")` was added before `_is_initialized = true` in `NoticeCore.init` (`client/godot/core/notice_core/notice_core.gd:122`); `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_lifecycle.gd` failed `test_lifecycle`, `test_release_ends_fetch_load_image_and_wait_maintenance_clear`, `test_release_while_the_maintenance_popup_is_open_ends_the_wait`, `test_core_node_destroyed_without_release_cleans_up` and `test_set_image_downloader_after_init_is_ignored` with `unchecked error logs: NoticeCore: unexpected init error` (or a wrong `errors()` count), and `test_release_before_init_drops_the_image_downloader` passed | Do not release `LogCore` in the middle of a test: split the test in two, one that does `LogCore.init()`, `set_image_downloader`, `release` and checks `errors()`/`warns()` are 0 and `_downloader_override` is `null`, and ends there; and one that does `set_image_downloader`, `release` without `LogCore.init()` and then `start()` and the image checks, so that the log collector stays registered for its whole run | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | Commit 29a4b168 calls `LogCore.init()` at `client/godot/core/notice_core/tests/test_lifecycle.gd:146` and checks `errors()`/`warns()` are 0 at `:153`-`:154`, right after `NoticeCore.release()` on the module that is not initialized. Restored the defect in a temporary worktree (`git worktree add --detach` at d8b58af1) by adding `LogCore.log_warn(_TAG, "release before init")` after `_downloader_override = null` in the not-initialized branch of `NoticeCore.release` (`client/godot/core/notice_core/notice_core.gd:129`); `ogw core test godot NoticeCore --file client/godot/core/notice_core/tests/test_lifecycle.gd` failed in that test with `[1] expected to equal [0]:  release before init leaves no log`. The side effect of the `LogCore.release()` of that fix at `:155` is written as R3-1 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only change of the commit range under `client/` is `client/godot/core/notice_core/tests/test_lifecycle.gd:144`-`:158`; NoticeCore module code did not change in the range and was not reviewed again. The other files of the range are review records of other targets and were not reviewed
- The unchanged `test_lifecycle.gd`, the whole NoticeCore suite and the `--web` run were not run in this review; only `test_lifecycle.gd` was run, on the two mutated copies described above
