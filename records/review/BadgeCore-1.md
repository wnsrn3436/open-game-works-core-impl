# review BadgeCore round 1

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

- The commit range 625ae189..48a69324 changes no file under `client/godot/core/badge_core/`, nor `core-spec/BadgeCore.json`, `test-data/data/tables/badge.csv` or a `BadgeCore.*` settings key. Of the dependencies of BadgeCore, it changes only `client/godot/core/data_core/data_core.gd` (`release` of a module that is not initialized resets the built-in location and version), which BadgeCore does not read. BadgeCore code that predates the range was not reviewed line by line
- Changes that reach BadgeCore from outside its dependencies: DEV `shutdown` now calls `release` of every module, also of modules that are not initialized (`client/godot/core/bootstrap_core/bootstrap_core.gd:1350`), and `UnitTestCore` no longer calls `TimeCore.release` itself between tests (`client/godot/core/unit_test_core/dev/unit_test_core.gd:396`, `client/godot/core/unit_test_core/dev/unit_test_core.gd:643`). `BadgeCore.release` returns at once when not initialized (`client/godot/core/badge_core/badge_core.gd:80`), and BadgeCore has no DEV operation and no operation called before `init` (`BadgeView.bind` before `init` fails in `_usable_badge` and keeps nothing, `client/godot/core/badge_core/badge_core.gd:264`), so there is no value set before `init` that this `release` would have to delete. The BadgeCore test setup sets the `ResourceCore` test key list again before each `init` (`client/godot/core/badge_core/tests/support/badge_test_case.gd:58`). `ogw core test godot BadgeCore` passed on this checkout (no test record was written because the checkout has the uncommitted deletion of this review file)
- `NoticeCore` (a caller of BadgeCore) changes only its `release` before `init` (`client/godot/core/notice_core/notice_core.gd:128`), which calls no BadgeCore operation; NoticeCore itself is outside this target and was not reviewed
