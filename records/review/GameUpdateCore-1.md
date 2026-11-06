# review GameUpdateCore round 1

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

- The commit range `de482eec..ffce30f2` changes no file under `client/godot/core/game_update_core/` and no code of the modules in `## dependency` of the GameUpdateCore spec (`UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `ResourceCore`, `DataCore`, `LocalizationCore`, `UICore`, `NetworkCore`). Input `## spec changes` is `none`. So only the changes that GameUpdateCore code or tests reach were read: `client/godot/core/sound_core/sound_core.gd`, `client/godot/core/tween_core/tween_core.gd`, `client/godot/core/tween_core/tween_record.gd` and `client/godot/core/pool_core/pool_core.gd` (only `init`/`release` of these are called by `client/godot/core/game_update_core/tests/support/game_update_test_case.gd:297-327`, and `UICore` may play tweens), and the settings additions `QACore.frameIntervalMaxCount` and `QACore.rewardPresentationWindowMs` in `settings/core-settings.json`, `settings/core-settings.schema.json` and `client/godot/generated/`. The new state in those modules (`_dev_mutes`, `_play_skip`, `_finite_skip`, `_effect_skip`) is `false` after `init` and reset in `release`, and only `*CoreDev` setters change it, so with the defaults the behavior GameUpdateCore relies on does not change. No problem was found there
- The GameUpdateCore code and tests themselves, outside what the range reaches, were not reviewed, because the commit range is not `none`
- The GameUpdateCore core tests were not run in this review: no finding needed checking, and `ogw review run` runs the core tests of the dependent modules after each fix
