# review BootstrapCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/bootstrap_core/bootstrap_core.gd:1291 | `shutdown` step 3 of the spec (skills/client-core/modules/bootstrap-core.md:235) requires `AuthCore.clear_dev_values` to be called while the scope text of `AuthCore` is still set, also when `AuthCore` is not in the module list, so that the next test finds no storage item and no fake social account, fake tracking state or DEV token storage. This range added the call (`_dev.before_shutdown_release()` → `AuthCoreDev.clear_dev_values()`, client/godot/core/bootstrap_core/dev/bootstrap_core_dev.gd:219-220), but no test checks it. Reproduced: in a temporary `git worktree add` copy of HEAD with line 1291 replaced by `pass`, `ogw core test godot "BootstrapCore AuthCore"` passed every test of both modules. No BootstrapCore test reads the AuthCore DEV values or the storage item of the scope after `shutdown` | Add a BootstrapCore test: boot with `AuthCore` in the module list, call `AuthCoreDev.set_fake_social_account`, `set_fake_tracking_status` and write a storage item of the scope through the DEV token storage, call `shutdown`, and check that the fake values and the DEV token storage are gone and the storage item of the scope is deleted (after the storage operations in progress); add the case where `AuthCore` is not in the module list (the DEV values are still cleared) | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Checked the changes of the range that touch BootstrapCore (`_shutdown`, `_release_entry`, `BootstrapDevHooks.before_shutdown_release`, `BootstrapCoreDev.before_shutdown_release`, the new test `test_boot_shutdown_pre_init.gd`) and the removal of `_clear_pre_init_values` from `UnitTestCore`. `ogw core test godot BootstrapCore` passes on HEAD. Restoring the old `_release_entry` (release only initialized modules) in a temporary worktree makes `test_boot_shutdown_pre_init.gd::test_2_...` fail on both asserts, so the new test checks that behavior
- Read the non-initialized path of `release` of every lifecycle module that `shutdown` now calls (the modules of `generated/core_modules.gd` and `QACore`) only against the DEV and before-`init` operations whose setters work before `init`; found no pre-init value left uncleared, but did not run the tests of those modules, and did not check that each non-initialized `release` calls no other module and leaves no log in every state (e.g. `InputCore` and `VirtualPadCore` run `_cleanup(true)` when `_node` is set while not initialized)
- Did not check the release order of `shutdown` against the order rule of the module list, or the release of entries of a test module list that are not generated modules: code not changed in this range
- Did not run the browser run (`--web`) of the BootstrapCore tests
