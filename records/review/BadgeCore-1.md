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

- The commit range 85f6b36d..9808fd47 changes no file under `client/godot/core/badge_core/`, nor `core-spec/BadgeCore.json`, `test-data/data/tables/badge.csv` or the `BadgeCore.*` keys of `settings/core-settings.json` and `client/godot/generated/core_settings.json`. In the dependencies, it changes only `client/godot/core/time_core/time_core.gd`, `client/godot/core/time_core/dev/time_core_dev.gd` (`make_random_seed`, DEV frame step, DEV random base) and comments of `client/godot/core/log_core/log_core.gd`. BadgeCore reads only `TimeCore.get_real_time` (`client/godot/core/badge_core/badge_core.gd:74`, `client/godot/core/badge_core/badge_core.gd:437`). The frame step changes the real increment only on the path without a test clock (`client/godot/core/time_core/time_core.gd:421`), and the BadgeCore tests advance time through the test clock (`client/godot/core/badge_core/tests/support/badge_test_case.gd:112`), so the range does not change BadgeCore behavior or its tests. Because the range has no changes to BadgeCore, BadgeCore code that predates it was not reviewed line by line
- The BadgeCore core tests were not run in this review: there was no finding to check and no defect to restore
