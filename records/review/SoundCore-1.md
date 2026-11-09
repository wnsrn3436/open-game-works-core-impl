# SoundCore review round 1

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

- The range 625ae189..3ca5a94f changes no file of `client/godot/core/sound_core/` and no file of the modules SoundCore depends on (UtilCore, LogCore, EventCore, TimeCore, LocalDataCore, ResourceCore, InputCore). Of the SoundCore-related changes, only these were checked: `BootstrapCore._release_entry` now calls `release` also for a module that is not initialized (client/godot/core/bootstrap_core/bootstrap_core.gd:1347-1350), and `UnitTestCore` no longer calls `_clear_pre_init_values` (client/godot/core/unit_test_core/dev/unit_test_core.gd). `SoundCore.release` of a module that is not initialized only returns (client/godot/core/sound_core/sound_core.gd:221-223). This follows `skills/core/SKILL.md:73` (open-game-works-core), because no SoundCore operation keeps a value before `init`: every DEV operation of `SoundCoreDev` logs an error and returns when SoundCore is not initialized (client/godot/core/sound_core/dev/sound_core_dev.gd:11,38,59,68,81), and the spec has no operation called before `init`. The `TimeCoreDev.set_random_base` value set before `init` in tests/test_variation.gd:102 is now cleared by the `TimeCore.release` of `shutdown` and no longer by `_clear_pre_init_values`
- Tests run: `ogw core test godot SoundCore --file test_lifecycle.gd` and `--file test_variation.gd`, both pass. The other SoundCore test files were not run, because the range changes no code they reach except the `shutdown` path between tests, and both files go through that path
- The callers of SoundCore changed in the range (`AdCore.release` before `init` at client/godot/core/ad_core/ad_core.gd:85-90, `QACore`, the `AuthCore` test environment) and the other commits of the range (server core, other client modules) are outside this target and were not reviewed beyond their SoundCore calls
