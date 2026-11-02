# NoticeCore review round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range `d4c3ae7..7c07df7` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`), no file of the server `notice` module (`server/core/notice/`, `core-spec/notice.json`), no file of `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `LocalizationCore`, `NetworkCore` or `BadgeCore`, and no contract (`proto/`, `client/godot/generated/contract/`). `git diff --name-only` of the range lists no path under `server/`. Its client changes are `client/godot/core/ui_core/ui_core.gd`, UICore tests and test prefabs, `client/godot/core/qa_core/dev/qa_query.gd`, QACore tests and test prefabs, `core-spec/UICore.json` and `client/godot/generated/core_settings.json`. The rest are run records of other agents and review lists
- Checked how the changes reach NoticeCore:
  - `UICore` is the one changed module in NoticeCore's `## dependency`. The `ui_core.gd` diff adds `is_dimmed`, `_is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`), and the only lines it removes are two section comments, so `open_system_popup` (`client/godot/core/ui_core/ui_core.gd:505`), the dim placement and `get_layer` run as before. NoticeCore code uses `UICore` only through `open_system_popup` (`client/godot/core/notice_core/notice_core.gd:604`), and its tests use `get_open_popup_count`, `close_all_popups`, `get_layer`, `init`, `prepare` and `release`
  - `is_dimmed` is referenced only by `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/tests/test_dimmed.gd` and `client/godot/core/qa_core/dev/qa_query.gd`. No file under `client/godot/core/notice_core/` refers to it, to `QACore` or `qa_core`, or to `list_ui`
  - `QACore` is not in NoticeCore's `## dependency`. Its `list_ui` reads the new `dimmed` field for any visible element, including the maintenance popup. That result for a system popup belongs to the `UICore` and `QACore` targets and was not reviewed here
  - The UICore and QACore test support changes (`client/godot/core/ui_core/tests/support/ui_test_case.gd`, `client/godot/core/qa_core/tests/support/qa_test_case.gd`) only add test prefab constants and resource keys. The NoticeCore tests do not use these two files. They use their own `client/godot/core/notice_core/tests/support/notice_test_case.gd`, which the range does not change
  - Core settings: the `core_settings.json` diff removes only `uiQuality.maxFlatShare`. `client/godot/core/notice_core/` does not refer to `uiQuality` or `maxFlatShare`, and the four `NoticeCore.*` keys are unchanged (`client/godot/generated/core_settings.json:266`)
- Input `## spec changes` is `none`, so no definition change was compared with the code. The spec `is_dimmed` items and the system popup prefab items (`skills/client-core/modules/ui-core.md:461`, `skills/client-core/modules/ui-core.md:502`) were read only to see whether they set anything for NoticeCore. They do not, because `notice-core.md` sets only the popup's button, back input, body and extra text
- NoticeCore code and tests that the range does not change were read only for the references above and for the maintenance popup opening (`client/godot/core/notice_core/notice_core.gd:585`). They were not checked for problems that existed before the range
- The server `notice` module is a separate review target and was not reviewed here
- The NoticeCore core tests were not run in this review, because there was no finding to check and the checkout has no GUT addon (`client/godot/addons/` is absent; `ogw core test` fills it). `records/1793645028102-update-core-mvzlxt6u5be5ef.md` reports that `ogw core test godot --web` passed 25 of 25 modules for UICore, QACore and their dependents. `NoticeCore` is named in the commands of those runs (`records/1793645028102-update-core-mvzlxt6u5be5ef-runs.json:65`) and is not one of the 3 modules that report lists as skipped in the native run. That report was read and not reproduced
