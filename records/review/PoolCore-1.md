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

- Commit range changes of PoolCore: `client/godot/core/pool_core/pool_core.gd` (`_lend`, `_add_skip`, `_flush_effect_skip`, `init`, `_reset`), `client/godot/core/pool_core/dev/pool_core_dev.gd`, `client/godot/core/pool_core/tests/test_effect_skip.gd`, `client/godot/core/pool_core/tests/support/pool_core_test_object.gd`. The callers of the changed code in the same file (`borrow`, `give_back`, `notify_finished`, `_take_back`, owner scope release, pool scope release, predelete, `release`, tree teardown) were read. `ogw core test godot PoolCore` passed
- Whether the pinned Godot runs deferred calls queued after the last message queue flush of `SceneTree.process` (from the delete queue, `SceneTreeTimer` timeouts, `Tween` callbacks) before it draws the frame was not checked against the engine source. The implementation follows the `PoolCore` row of the godot engine rules for the take-back of the effect skip, and the tests cover a borrow in the process step and in the physics step only
- The `state != BORROWED` condition in `_flush_effect_skip` cannot be reached by a handle that `_instance_of` accepts (the generation number goes up before `on_return`, and an instance at the maximum generation number is destroyed), so no test goes through it. It changes no behavior and is `low`, which a review with a commit range does not write
- The callers of `PoolCoreDev.set_effect_skip` in `QACore` were not read: they are in the QACore target
