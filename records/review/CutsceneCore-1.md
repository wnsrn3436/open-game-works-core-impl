# review CutsceneCore round 1

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

- The commit range 625ae189..98f556d3 changes no file of `client/godot/core/cutscene_core/`, `core-spec/CutsceneCore.json` or the cutscene test data. The review covered the changed code that reaches CutsceneCore: `BootstrapCore.shutdown` now calls `release` of every lifecycle module, also one that is not initialized (client/godot/core/bootstrap_core/bootstrap_core.gd:1347-1350), `DataCore.release` of a module that is not initialized now resets the test data location and the built-in version (client/godot/core/data_core/data_core.gd:58-65), `UnitTestCore` no longer calls `_clear_pre_init_values` (TimeCore is now released by `shutdown`), and the new DEV hook `before_shutdown_release` (`AuthCoreDev.clear_dev_values`)
- `CutsceneCore.release` of a module that is not initialized returns at once (client/godot/core/cutscene_core/cutscene_core.gd:220-222). The CutsceneCore spec has no DEV operation and no operation called before `init` (cutscene-core.md `## DEV` is none), so it has no value set before `init` to delete, which matches the rule for `release` before `init` of core SKILL.md (no call to another module, no log). So the release of a not-initialized CutsceneCore by `shutdown` leaves no log and changes no state
- The cutscene tests set their test settings, resource key list and data only inside each test after `UnitTestCore` setup (client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd:96-159), so the DataCore reset of the test data location in `shutdown` does not remove a value they rely on
- `ogw core test godot CutsceneCore` passes on the checkout at 98f556d3. It wrote no test record because the checkout has uncommitted changes (only this review file)
- Not checked: the core tests of other modules and the whole suite, as no finding says that something fails outside the CutsceneCore tests
