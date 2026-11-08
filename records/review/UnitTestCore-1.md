# review UnitTestCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | correctness | medium | client/godot/core/unit_test_core/dev/unit_test_core.gd:751 | D1 remains. `_setup_test` (unit_test_core.gd:643-645) and `_close_run` (unit_test_core.gd:396-397) reset modules only with `BootstrapCoreDev.shutdown()` and then `_clear_pre_init_values`, which clears only TimeCore. `shutdown` walks the generated module list (client/godot/core/bootstrap_core/bootstrap_core.gd:1293-1297), but `_release_entry` (bootstrap_core.gd:1343) calls `release` only when `is_initialized` is true. `DataCoreDev.set_test_data_location` (client/godot/core/data_core/dev/data_core_dev.gd:7-13) sets `DataCore._builtin_location` before `init`, and only `DataCore.release` resets it (client/godot/core/data_core/data_core.gd:73). Run path: test A calls `DataCoreDev.set_test_data_location("res://x/")` and returns (or fails) before `DataCore.init`; in test B, `DataCore.get_builtin_location()` (data_core.gd:133) and the built-in data load (data_core.gd:318, 334, 346) use `res://x/` and not `res://build/data/`. That breaks "A test does not depend on the results or the run order of other tests" (skills/client-core/modules/unit-test-core.md:41) and "The result of running test files one at a time and the result of running all of them at once are the same per test" (unit-test-core.md:244). The same kind of value exists in other modules: `ResourceCoreDev.set_test_key_list` (client/godot/core/resource_core/dev/resource_core_dev.gd:31-37), `GameUpdateCoreDev.set_downloader` (client/godot/core/game_update_core/dev/game_update_core_dev.gd:12), `NoticeCoreDev.set_image_downloader` (client/godot/core/notice_core/dev/notice_core_dev.gd:12), and `AuthCoreDev.set_fake_social_account`/`set_fake_tracking_status`/`use_dev_token_storage` (client/godot/core/auth_core/dev/auth_core_dev.gd:41, 52, 58). Their specs say `release` clears them (e.g. resource-core.md:152 "A release before `init` also deletes it"). The same mechanism was reproduced for TimeCore in the earlier review (records/review/UnitTestCore-1.md at commit c59c25da, R1-1). The DataCore case was traced from the code and not run | UnitTestCore cannot call DataCore, ResourceCore, AuthCore, GameUpdateCore or NoticeCore, because they are not in its `## dependency` (unit-test-core.md:21), and BootstrapCore step 3 says "A module that is not `init`ed stays as it is" (skills/client-core/modules/bootstrap-core.md:235). That conflicts with "returns the boot and all modules to their initial state between tests" (bootstrap-core.md:232). Change bootstrap-core.md:235 so that `shutdown` also calls `release`, without a log, on modules that are not `init`ed (each module's `release` before `init` already clears its pre-init DEV values). Then remove the `_is_initialized` gate in `_release_entry` and the TimeCore-only `_clear_pre_init_values`. Add a core test of two consecutive tests: the first sets `set_test_data_location` (or `set_test_key_list`) without `init`, and the second reads the default | yes | 90 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `_clear_pre_init_values` (client/godot/core/unit_test_core/dev/unit_test_core.gd:751-753) still clears only TimeCore. `BootstrapCore._release_entry` (client/godot/core/bootstrap_core/bootstrap_core.gd:1343) still skips modules that are not initialized. `DataCore._builtin_location` is still reset only in `DataCore.release` (client/godot/core/data_core/data_core.gd:73). The commit range is empty, so nothing changed since the item was written |

## must fix

none

## unknown

- The commit range 625ae189..625ae189 is empty, so no code changed in this range and there are no findings caused by the range. Only the debt item D1 was reviewed, together with the code it points to: UnitTestCore test setup and run close, BootstrapCore `shutdown`/`_release_entry`, the DataCore DEV location, and the DEV setters of ResourceCore, GameUpdateCore, NoticeCore and AuthCore
- The DataCore leak of R1-1 was not run as a two-test reproduction; it was traced from the code. No core test was run in this round
- AccessibilityCoreDev (client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:12) was only checked to the point that `set_test_text_scale` starts with a check of `_is_initialized`. Whether it keeps a value before `init` was not checked
- No check was made for modules other than those named in D1 that keep DEV values set before `init`
- The rest of the UnitTestCore code was not reviewed again in this round: the fake network, the test host client, the WebSocket relay, the fake realtime transport, input injection, the time limits and the result file
