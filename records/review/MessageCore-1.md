# MessageCore review round 1

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

- The commit range de482eec..e4a411a3 does not change any file of `client/godot/core/message_core/` or its tests. Its changes in the dependencies of MessageCore are the DEV effect skip of `PoolCore` (`client/godot/core/pool_core/pool_core.gd` `_lend`, `_add_skip`, `_flush_effect_skip`) and the DEV finite skip of `TweenCore` (`client/godot/core/tween_core/tween_core.gd` `_begin`, `_queue_end_due`). Both were read against MessageCore's use of them: the effect skip acts only on auto-return borrows, and the toast object is a manual-return pool object; a toast or black box enter or exit preset under the finite skip ends with `Completed` in the deferred flush, and `MessageCore._advance` (`client/godot/core/message_core/message_core.gd:173`) moves to the next display step on `not TweenCore.is_playing`, so the display order and the real-time display duration stay as the spec sets. No problem caused or revealed by the range was found
- A toast prefab whose `PoolObject.auto_return` is true (against the spec rule that the toast prefab is a manual-return pool object) under the `PoolCore` effect skip was not checked by a run; it is outside what the spec allows as input and no finding was written
- The core tests of MessageCore were not run in this review: no finding needed a run to check it, and `ogw review run` runs the core tests of the modules that depend on the changed modules
