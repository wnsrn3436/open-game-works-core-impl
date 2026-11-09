# review NoticeCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/notice_core/notice_core.gd:129 | Commit ad967246 adds to `release` of a NoticeCore that is not initialized the deletion of `_downloader_override`, the value `NoticeCoreDev.set_image_downloader` sets before `init` (the behavior `core/SKILL.md` `## lifecycle` sets for a `release` of a module that is not `init`ed, together with `notice-core.md` `### release`: `release` deletes the image downloader received with `set_image_downloader`). No test goes through it: the only test call of `set_image_downloader` before `init` is `start` (`client/godot/core/notice_core/tests/support/notice_test_case.gd:68`), which calls `NoticeCore.init` right after it, and every `NoticeCore.release()` of the tests (`test_lifecycle.gd:20`, `:80`, `:100`, `test_badge.gd:73`, `test_read_state.gd:15`, `notice_test_case.gd:43`) runs either on an initialized NoticeCore or with no override set. `test_boot_shutdown_pre_init.gd` of the same commit checks only `DataCore` and `ResourceCore`. With line 129 deleted, no test of `ogw core test godot NoticeCore` reaches the changed path, so a downloader set by a test that ended before `NoticeCore.init` (e.g. its earlier setup failed) would stay for the next `init` undetected. | Add a test: `NoticeCoreDev.set_image_downloader(d)` without `init`, `NoticeCore.release()`, then `NoticeCore.init()` and check that `load_image` does not use `d` (e.g. `_downloader != d`, or no `download` call on `d`), and that the `release` left no log | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The only change of the commit range in `client/godot/core/notice_core/` is `release` of a module that is not initialized (`notice_core.gd:127`-`:130`). The NoticeCore code that the range does not reach was not reviewed again. No `Notice`, `NoticeKind`, `GetNoticesRequest` or `GetNoticesResponse` definition and no file of server core `notice` changed in the range
- Changes of the range in modules NoticeCore depends on or that call it: `NetworkCore.release` of a module that is not initialized now clears its transport (NoticeCore does not call `NetworkCore.release`), `BootstrapCore` DEV `shutdown` now calls `release` of every module also when it is not initialized and calls `AuthCoreDev.clear_dev_values` first, and `UnitTestCore` no longer calls `_clear_pre_init_values`. NoticeCore's `release` on a module that is not initialized calls no other module, leaves no log and ends no operation, as `core/SKILL.md` `## lifecycle` sets. The `TimeCore`, `LogCore`, `EventCore`, `LocalDataCore`, `LocalizationCore`, `UICore` and `BadgeCore` code that NoticeCore calls is unchanged in the range and was not reviewed
- `ogw core test godot NoticeCore` passed on the code of the range. The missing test of R1-1 was found by reading the tests; the test with line 129 deleted was not run, because no test calls `release` on a NoticeCore that is not initialized after `set_image_downloader`
