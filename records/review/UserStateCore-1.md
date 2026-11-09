# review UserStateCore round 1

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

- The commit range 625ae189..ec10a3ca changes no file of `client/godot/core/user_state_core/` and no file of `core-spec/` for UserStateCore (only `core-spec/storage.json`, a server module). Of the modules UserStateCore depends on, the range changes only `client/godot/core/data_core/data_core.gd`: `DataCore.release` of a DataCore that is not initialized now resets only the test data location and the built-in version (client/godot/core/data_core/data_core.gd:59-65). UserStateCore reads tables only through operations that run while it is initialized, so this branch does not reach it
- The range changes DEV `BootstrapCore.shutdown` so that it calls `release` also on lifecycle modules that are not initialized (client/godot/core/bootstrap_core/bootstrap_core.gd:1347-1350), and removes `_clear_pre_init_values` from `UnitTestCore` (client/godot/core/unit_test_core/dev/unit_test_core.gd:396, 643, where `BootstrapCoreDev.shutdown` is now called without it). Checked that this reaches UserStateCore without a defect: `UserStateCore.release` of a module that is not initialized returns at once without a log or a call to another module (client/godot/core/user_state_core/user_state_core.gd:59-61). UserStateCore has no operation that the spec says is called before `init`: every operation, `register_after_update` and the DEV operations `export_json`, `apply_test_delta` return a failure value before `init` and set no state (client/godot/core/user_state_core/user_state_core.gd:81-505, client/godot/core/user_state_core/dev/user_state_core_dev.gd:10, 39). So there is no value set before `init` for that `release` to delete, which matches `## lifecycle` of open-game-works-core/skills/core/SKILL.md:73
- The range changes `AuthCore` (storage waits, `clear_dev_values`), but not its call of `UserStateCore.set_user_created_at` (client/godot/core/auth_core/auth_core.gd:741). The `AdCore`, `NetworkCore` and `PaymentCore` changes do not touch their calls of UserStateCore (client/godot/core/ad_core/ad_core.gd:166, 480, client/godot/core/payment_core/payment_core.gd:660-913)
- This range review did not review again the UserStateCore code that the range does not reach
- The core tests of UserStateCore were not run in this review. `ogw review run` runs the core tests of the modules that depend on the changed modules
