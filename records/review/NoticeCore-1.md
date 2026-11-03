# review: NoticeCore round 1

## findings

none

## previous

none

## out of scope

- open-game-works-core/skills/client-core/modules/notice-core.md:141: medium The data check of this `## data` rule does not exist. This line says that a `[notice_badge]` badge row with `persist` other than `false` is data check `out_of_range`, and `open-game-works-core/skills/core/command.md:125` puts such a rule in `checks/<module name>.ts` with a data tool test that gives an ERROR. `tools/data-tool/src/checks/` has no `NoticeCore.ts` (`tools/data-tool/src/checks/ChatCore.ts` is the same rule for `[chat_badge]`), `core-spec/NoticeCore.json` has `"invariants": []`, and `grep notice_badge` over `tools/data-tool/src` and `tools/data-tool/tests` finds nothing. Run path: a game sets `persist` `true` on that row and the data tool gives no ERROR; `BadgeCore` then saves the notice items in the `user` file and restores them after a restart. This existed before the range (`client/godot/core/notice_core` last changed in 301b3dd).
- client/godot/core/notice_core/notice_core.gd:601: medium "Back input does not close it" (`open-game-works-core/skills/client-core/modules/notice-core.md:79`) has no `NoticeCore` test. No test under `client/godot/core/notice_core/tests/` sends back input or reads `back_button`. Changing this line to `param.back_button = 0` is not exercised by any assert of `test_maintenance.gd`, so back input could close the maintenance popup without a test failing. `client/godot/core/ui_core/tests/test_system_popup.gd:30` tests only the `UICore` side, with a popup it makes itself. This existed before the range.
- client/godot/core/notice_core/notice_core_node.gd:57: medium `cancel()` of the default image downloaders has no test, although the spec type table says that `cancel()` ends a `download` in progress with `Cancelled` and `release` and the time limit depend on it. The `cancel` asserts in `client/godot/core/notice_core/tests/test_image.gd:121` and `client/godot/core/notice_core/tests/test_lifecycle.gd:86` uses the hanging test downloader, whose `cancel` only counts. `http_cancel` here and `cancel` at `client/godot/core/notice_core/web_image_downloader.gd:67` are not run by a test while a download is in progress. This existed before the range.

## debt

none

## must fix

none

## unknown

- The range `f3ac5b0..0da153b` changes only `client/godot/core/localization_core/localization_core.gd` (`_restore_heading_types`), `client/godot/core/localization_core/tests/test_font_weight.gd` and records. The reach into this target was checked by reading: `NoticeCore` calls only `LocalizationCore.get_language_code`, and its test support calls `LocalizationCore.release`. No file under `client/godot/core/notice_core` or `client/godot/core/ui_core` names a heading type. This finds no problem that the range causes or reveals in `NoticeCore`.
- The core tests were not run in this review. `records/1793718260785-update-core-mw0tjfw196b34a.md` and `records/1793719054821-review-fix-mw0u0gkl5c81ec.md` report that `ogw core test godot` and `godot --web` pass for the dependents of `LocalizationCore`. `NoticeCore` depends on `LocalizationCore` directly, so it should be in that set, but the reports do not name it.
- The system popup drawn with a project theme or a heading style was not run. No core code sets a heading style on it, and a popup prefab of a game was not read.
- The code of server core `notice` was not read. Only its spec was read, because no file of the range is on that side.
- `client/godot/core/notice_core/web_image_downloader.gd` was read and not run in a browser in this review.
- The three `## out of scope` items were found by reading and `grep`. No mutation was run, because this review does not edit code.
