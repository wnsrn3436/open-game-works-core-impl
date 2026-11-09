# TutorialCore review round 1

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

- The commit range 625ae189..e6a76e44 changes no file of `client/godot/core/tutorial_core/` and no file of the server `tutorial` module (`server/core/tutorial/`). The review checked the changes of the range in the modules TutorialCore and `tutorial` depend on, at the places they call them.
- `client/godot/core/bootstrap_core/bootstrap_core.gd`: DEV `shutdown` now calls `release` of every lifecycle module, also of a module that is not initialized. `TutorialCore.release` of a module that is not initialized returns at once (`client/godot/core/tutorial_core/tutorial_core.gd:139`). The TutorialCore spec has `## DEV` `none` and no operation called before `init`, so it has no values set before `init` to delete, and the early return meets the rule for a `release` of a module that is not initialized (`core` skill `SKILL.md:73`): no other module call, no log.
- `client/godot/core/auth_core/auth_core.gd` and `client/godot/core/auth_core/dev/auth_core_dev.gd`: `release` no longer deletes the DEV values (fake social account, fake tracking state, DEV token storage), which `AuthCoreDev.clear_dev_values` deletes, and storage waits are moved to a separate list. TutorialCore reads only `AuthCore.is_logged_in` (`tutorial_core.gd:438`); none of these changes changes the logged in state. The TutorialCore tests use `AuthCoreDev.dev_login` only, not the values that `release` now keeps.
- `client/godot/core/data_core/data_core.gd`, `client/godot/core/network_core/network_core.gd`: only the `release` of a module that is not initialized changed (it deletes the test data location and the transport). TutorialCore calls `DataCore.is_loaded` (`tutorial_core.gd:315`) and `NetworkCore.send` (`tutorial_core.gd:835`) only while initialized, so these paths are not reached from TutorialCore.
- `client/godot/core/unit_test_core/dev/unit_test_core.gd`: the TimeCore pre-init clear between tests is removed, as `shutdown` now releases TimeCore when it is not initialized. TutorialCore reads TimeCore only while initialized.
- `server/core/storage/core.ts`, `server/core/storage/tx.ts`, `server/core/storage/index.ts`: `fail_transaction` is added, and `user_state_of`/`any_state_of` throw on a transaction it marked. The `tutorial` module (`server/core/tutorial/index.ts:63`, `:73`, `:79`) does not call `fail_transaction`; on an unmarked transaction the storage operations it calls behave as before.
- `server/core/logging/metrics.ts`: only a comment changed. `server/core/session/index.ts`: `tutorial` does not depend on `session`.
- `ogw core test godot TutorialCore` (job mw8m61ne350ecb) and `ogw core test server tutorial` (job mw8m62v273f922) passed on HEAD e6a76e44. Both reported no test record, because the checkout had the uncommitted deletion of the earlier `records/review/TutorialCore-1.md`.
