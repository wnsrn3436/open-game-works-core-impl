# review PoolCore round 1

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

- The commit range changes PoolCore only by removing the DEV effect skip (`PoolCoreDev.set_effect_skip`, `_effect_skip`, `_skip_*`, `_flush_effect_skip`, `test_effect_skip.gd`, `return_frame` of the test object). The PoolCore spec `## DEV` no longer defines it. A search of the checkout outside `records/` finds no remaining reference to `PoolCoreDev`, `set_effect_skip`, `_effect_skip`, `_skip_handles` or `return_frame`. `_lend` (client/godot/core/pool_core/pool_core.gd:404) now behaves as the old code did with the skip off: it publishes `EffectSpawnedEvent` after `on_borrow` for an auto-return instance. `client/godot/core/pool_core/tests/test_return.gd` still tests that event
- `ogw core test godot PoolCore` passed (job mw9ai5du50cb5f)
- The code of PoolCore outside the changed places and their callers and callees was not reviewed, because the commit range is not `none`
- The QACore, SoundCore, CameraCore, ScreenEffectCore, TweenCore and NetworkCore changes of the same range were not reviewed, because they are outside the target
