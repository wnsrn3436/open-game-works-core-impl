# BootstrapCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | test-data/data/system/reserved_string.csv:46 | bootstrap-core.md line 94-95 and the format argument table (lines 193, 195) set `until_at` and `expires_at` as `set_int` / `integer`. The range makes the ban popup tests assert the rendered body text (client/godot/core/bootstrap_core/tests/support/boot_test_support.gd `_popup_text`, test_boot_login.gd:53, 68, 85), and its core test data writes those arguments without a formatter (`{until_at}` at reserved_string.csv:46, `{expires_at}` at reserved_string.csv:49). In data SKILL.md, formatter `none` writes an integer as decimal without separators and a string as it is, so an integer and its decimal string give the same text. Run path: in a temporary copy (worktree of 2c764e2 under worktrees/_core/), bootstrap_core.gd:972 `args.set_int("until_at", result.ban_until_at)` was changed to `args.set_string("until_at", str(result.ban_until_at))`, and `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_login.gd` passed. The same applies to `expires_at` at bootstrap_core.gd:1008 (read, not run). In a game whose translation uses an integer-only formatter (e.g. `{until_at:datetime}`), the string kind gives an error slot and the ban end time is left empty, and no core test catches it | Give `{until_at}` and `{expires_at}` in the core test data an integer-only formatter that does not depend on the device timezone (e.g. `ordinal` or `duration`), and change the expected text in test_boot_login.gd to match. A `set_string` or `set_float` value then becomes an error slot and the test fails | no | 88 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_open_failure_popup` now keeps the `SystemPopupParam` it passes to `UICore.open_system_popup` (client/godot/core/bootstrap_core/bootstrap_core.gd:1055-1058). Test support renders the body with `LocalizationCore.format(param.body, param.format_args)` (tests/support/boot_test_support.gd:321-330). The core test data bodies now hold `{public_code}` (test-data/data/system/reserved_string.csv:46, 47, 49). Both defects of R1-1 were restored in temporary copies (worktrees of 2c764e2 under worktrees/_core/, removed afterwards), and `ogw core test godot BootstrapCore --file client/godot/core/bootstrap_core/tests/test_boot_login.gd` was run on each. (1) bootstrap_core.gd:971 `args.set_string("public_code", ...)` changed to `args.set_string("user_id", ...)`: fail. `test_banned_with_end_opens_banned_popup_with_format_args`, `test_banned_without_public_code_passes_empty_public_code` and `test_permanent_ban_opens_permanent_popup_and_deletion_code_popup_restarts` failed on the body text (`‼ {public_code}` instead of `K7M2-Q9XA` or empty), and three more tests failed on unchecked `LocalizationCore: format error slot {public_code}` logs. (2) bootstrap_core.gd:1005 `_grouped_public_code(_login_result.public_code)` changed to the ungrouped `_login_result.public_code`: `test_permanent_ban_opens_permanent_popup_and_deletion_code_popup_restarts` failed (`K7M2Q9XA` instead of `K7M2-Q9XA`) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range is 68dd3e2..2c764e2. BootstrapCore changes are client/godot/core/bootstrap_core/bootstrap_core.gd, tests/support/boot_test_support.gd, tests/test_boot_login.gd, and the core test data test-data/data/system/reserved_string.csv and test-data/data/translations/*.csv. The other changes of the range (TweenCore test, server core admin-api, friend, public-profile, storage, records/) are outside the target and were not reviewed
- Only test_boot_login.gd was run, on the mutated copies above and once on the unchanged checkout (pass). The other BootstrapCore test files were not run. Their uses of `popups()`, `popup()` and `trace_between()` (test_boot_fatal.gd, test_boot_exit.gd, test_boot_dev_modules.gd, test_boot_update.gd, test_boot_dev_run.gd) were read only: none passes the third argument of `popup()`, and none calls them after a popup was traced and then `BootstrapCoreDev.shutdown()` was called. `_shutdown` (bootstrap_core.gd:1285) clears `_traced_popups` but not `_trace`, so such a call would index past `_traced_popups`. No test does this now
- The `expires_at` mutation of R2-1 was not run. It was judged from the same rendering path and test data
- `tools/tests/game/data/system/reserved_string.csv:46-49` still has the bootstrap ban texts without format arguments. That is the contract and data tool round trip data, not BootstrapCore core test data, and was not checked further
