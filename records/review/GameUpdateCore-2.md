# review GameUpdateCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_VERSION_PART_MAX_DIGITS` is removed. `is_version` (`client/godot/core/game_update_core/deploy_list.gd:62-72`) now accepts three ASCII decimal parts of any length with no leading zero, which is the same set as server `VERSION` `/^(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)\.(0\|[1-9][0-9]*)$/` (`server/core/game-update/deploy_list.ts:56`). `compare_versions` (`deploy_list.gd:76-83`) compares each part with `_compare_decimals` (`deploy_list.gd:375-382`): it strips leading zeros (`_strip_leading_zeros` keeps the last digit, so `0` stays `0`), the longer string is greater, and equal-length digit strings compare by code point, which is numeric order. App versions that BootstrapCore accepts with leading zeros (`bootstrap_core.gd:753-760`, `is_valid_int`) still compare by value as `to_int` did before. New tests in `client/godot/core/game_update_core/tests/test_app_version.gd`: a 19-digit `min_version` passes the format check and opens the forced update popup, a 29-digit `recommended_version` opens the optional update popup, and `is_version` / `compare_versions` over 40-digit parts and around 2^63 and 2^64 in both directions. `ogw core test godot GameUpdateCore --file client/godot/core/game_update_core/tests/test_app_version.gd` passes on 393c84ae |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same problem as R1-1, fixed in d2de9bf6. A `min_version` such as `1.0.1000000000000000000` now passes `_check_platform_entry` (`deploy_list.gd:223`) because `is_version` has no digit limit, and the test `test_version_part_longer_than_int_range_is_accepted_and_compared_exactly` covers it |

## must fix

none

## unknown

- Only the changes of the range in the target were read: `client/godot/core/game_update_core/deploy_list.gd` (`is_version`, `compare_versions`, `_compare_decimals`, `_strip_leading_zeros`, `_check_platform_entry`), the callers `game_update_core.gd:376-395` (`_check_app_version`), and `tests/test_app_version.gd`. The other files changed in the range belong to other review targets (idempotency, nickname, admin-api settings schema, records) and were not reviewed
- R1-1 is a `spec` finding, not `test evidence`, so the defect was not restored in a worktree. The fix report says the three new tests fail on the old `deploy_list.gd`; this was not checked again
- Only `test_app_version.gd` was run, not the whole GameUpdateCore suite, the `--web` run, or the modules that depend on GameUpdateCore
