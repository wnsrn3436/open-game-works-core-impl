# review UnitTestCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `BootstrapCore._release_entry` (client/godot/core/bootstrap_core/bootstrap_core.gd:1343-1350) now calls `entry.release` also when `is_initialized` is false; only the trace call stays gated. `_shutdown` (bootstrap_core.gd:1290-1301) walks the boot module list and then the whole generated module list (client/godot/generated/core_modules.gd:7-45, which has TimeCore, DataCore, ResourceCore, AuthCore, GameUpdateCore, NoticeCore and AccessibilityCore) plus the DEV modules. It calls `AuthCoreDev.clear_dev_values` first through `before_shutdown_release` (client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:219-220). The TimeCore-only `_clear_pre_init_values` was removed from `_setup_test` and `_close_run` (client/godot/core/unit_test_core/dev/unit_test_core.gd:396, 643). The `release` of a module that is not initialized clears its pre-init values: DataCore resets `_builtin_location` (client/godot/core/data_core/data_core.gd release), ResourceCore clears the test key list, GameUpdateCore and NoticeCore clear `_downloader_override`, AuthCore runs `_clear_pre_init_values`, AccessibilityCore clears `_test_rendering_method`, and TimeCore always runs `_reset`. Spec now matches: bootstrap-core.md `shutdown` step 3 and the `## lifecycle` rule of skills/core/SKILL.md. New test client/godot/core/bootstrap_core/tests/test_boot_shutdown_pre_init.gd passes (`ogw core test godot BootstrapCore --file test_boot_shutdown_pre_init.gd`: pass). Restored the defect in a temporary `git worktree add` copy by moving `entry.release.call()` back under the `is_initialized` check in `_release_entry`; the same test failed: `test_2_...` got `res://core/bootstrap_core/tests/resources/no_data/` where it expected `res://build/data/`, and `ResourceCore` error log count was 0 where it expected 1. `ogw core test godot UnitTestCore` passes on this checkout |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same evidence as R1-1 in `## previous`: `shutdown` now releases modules that are not initialized, and DataCore `release` before `init` resets `_builtin_location` to the default. The test that sets `DataCoreDev.set_test_data_location` and `ResourceCoreDev.set_test_key_list` without `init` and checks the next test passes, and fails when the `is_initialized` gate is restored. The other modules D1 names (AuthCoreDev, GameUpdateCoreDev, NoticeCoreDev, ResourceCore, AccessibilityCore) clear their pre-init values in their `release` before `init` and are in the generated module list, so `shutdown` reaches them |

## must fix

none

## unknown

- The commit range also changes server modules and other client modules (AdCore, AuthCore, GameUpdateCore, PushCore, PaymentCore, NetworkCore, RealtimeCore and others). Only the changes that reach UnitTestCore were reviewed: `BootstrapCore._shutdown`/`_release_entry`, the `before_shutdown_release` DEV hook, the new BootstrapCore test, the removed `_clear_pre_init_values`, and the `release` functions of the modules in D1 and of TimeCore and LogCore
- Whether every other client module's `release` before `init` follows the new `## lifecycle` rule of skills/core/SKILL.md (no call to another module, no log, no operation ended) was not checked for every module. That belongs to the reviews of those modules
- The ordering and failure handling of `AuthCore.clear_dev_values` (the storage delete that runs after pending storage operations) was not checked; it is AuthCore behavior
- The effect of `shutdown` releasing LogCore, TimeCore and NetworkCore when they are not initialized was traced for the UnitTestCore paths that call it (`_setup_test`, `_close_run`, `_pop_run`, `_on_test_time_limit`, the run time limit). `_setup_test` and `_pop_run` register the replacements again after `shutdown`, and LogCore calls its listener only when initialized (client/godot/core/log_core/log_core.gd `_log`). This was checked from the code; only the UnitTestCore and BootstrapCore core tests above were run, not the whole client suite
- The browser run (`--web`) was not run
- The rest of the UnitTestCore code that the range did not change was not reviewed again: the fake network, the test host client, the WebSocket relay, the fake realtime transport, input injection, the time limits and the result file
