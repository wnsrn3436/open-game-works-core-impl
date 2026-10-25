# BootstrapCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | The core test data now gives both integer arguments the integer-only formatter `ordinal` (test-data/data/system/reserved_string.csv:46 `{until_at:ordinal}`, :49 `{expires_at:ordinal}`; regenerated test-data/data/translations/*.csv). The data skill format table says `ordinal` accepts only `integer` and does not depend on the timezone. The expected `en` text in client/godot/core/bootstrap_core/tests/test_boot_login.gd:53, 68, 85 (`1800000000000th`, `1700000600000th`) matches the `en` ordinal rule (last two digits `00` gives `th`). Both defects were restored in a temporary detached worktree of 98d1252 under worktrees/_core/ (removed afterwards), and `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_login.gd` was run on each. (1) bootstrap_core.gd:972 `args.set_int("until_at", result.ban_until_at)` changed to `args.set_string("until_at", str(result.ban_until_at))`: `test_banned_with_end_opens_banned_popup_with_format_args` failed (`‼ {until_at:ordinal}` instead of `1800000000000th`, plus unchecked `LocalizationCore: format error slot` logs). (2) bootstrap_core.gd:1008 `args.set_int("expires_at", code.expires_at)` changed to `args.set_string("expires_at", str(code.expires_at))`: `test_banned_without_public_code_passes_empty_public_code` and `test_permanent_ban_opens_permanent_popup_and_deletion_code_popup_restarts` failed (`‼ {expires_at:ordinal}` instead of `1700000600000th`). The unchanged copy passed the same file |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range is 2c764e2..98d1252. Its BootstrapCore changes are client/godot/core/bootstrap_core/tests/test_boot_login.gd and the core test data test-data/data/system/reserved_string.csv and test-data/data/translations/*.csv. The other changes of the range (records/ of TweenCore, friend, storage reviews) are outside the target and were not reviewed
- Only test_boot_login.gd was run (on the two mutated copies and once unchanged). The other BootstrapCore test files and the tests of other modules were not run. A search of client/, server/, tools/ and test-data/ found the changed texts `[bootstrap_banned]` and `[bootstrap_banned_deletion_code]` used as rendered text only in test_boot_login.gd, so the test data change was judged not to reach other tests
- A `set_float` mutation was not run. It was judged from the data skill format table, where `ordinal` does not accept `real`
- `tools/tests/game/data/system/reserved_string.csv:46-49` still has the bootstrap ban texts without format arguments. That is contract and data tool round trip data, not BootstrapCore core test data, and was not checked further
