# review ShortcutCore round 1

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

- Commit range de482eec..63b1acf2 changes no file under `client/godot/core/shortcut_core/` and none of the core spec, settings or generated settings of ShortcutCore. The changed modules are CameraCore, PoolCore, QACore, ScreenEffectCore, SoundCore and TweenCore, plus the QACore settings keys `frameIntervalMaxCount` and `rewardPresentationWindowMs`
- ShortcutCore code calls none of the changed operations. Its tests reach PoolCore, SoundCore, TweenCore and ScreenEffectCore only through `init` in `client/godot/core/shortcut_core/tests/support/shortcut_case.gd:82` and `:84`, and `client/godot/core/shortcut_core/tests/test_errors.gd:5` names `PoolCore` as a log tag. The changes in range add DEV switches (`PoolCoreDev.set_effect_skip`, `SoundCoreDev.set_dev_mute`/`set_play_skip`, `TweenCoreDev.set_finite_skip`, `ScreenEffectCoreDev.set_world_skip`, CameraCore `set_shake_skip`). Each switch is off by default and cleared by its module's reset, and ShortcutCore never turns one on, so its paths do not change. The added PoolCore `init` lines (`client/godot/core/pool_core/pool_core.gd:76-77`) only size the skip buffer and bind the take-back callable
- The rest of ShortcutCore was not reviewed, because the range does not touch it and the input has no `## debt` or `## must fix` items
- ShortcutCore tests were not run. A scratch-copy GUT run outside `ogw core test` did not load the UnitTestCore pre-run hook, so every test failed at `UnitTestCore: test setup before init` (`client/godot/core/unit_test_core/dev/unit_test_core.gd:636`). That run says nothing about ShortcutCore. `ogw review run` runs the core tests of dependent modules after each fix
