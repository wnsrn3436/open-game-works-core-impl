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

- The commit range 85f6b36d..4016c5a8 changes no file under `client/godot/core/pool_core/`, no `PoolCore` key of `client/godot/generated/core_settings.json` or `settings/core-settings.json`, and no `core-spec/PoolCore.json`; input `## spec changes` is `none`. Of the spec dependencies of PoolCore (`LogCore`, `EventCore`, `ResourceCore`), only `client/godot/core/log_core/log_core.gd` changed, and only in comments (`_escape`, `_event_problem`, `_enqueue_error`), so no PoolCore call to LogCore observes a different result. `client/godot/core/time_core/time_core.gd` (DEV frame step, `make_random_seed`) is not called by PoolCore code; only `client/godot/core/pool_core/tests/support/pool_core_test_case.gd:46` and `:57` call `TimeCore.init` and `TimeCore.release`, whose order and failure values did not change. The ScreenEffectCore test changes in the range do not touch pooling. So no change of the range causes or reveals a PoolCore problem, and the PoolCore code that existed before the range was not reviewed as a whole, because the commit range is not `none`
- The PoolCore core tests were not run in this review: no finding needed checking and no defect needed restoring
