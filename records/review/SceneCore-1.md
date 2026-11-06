# review SceneCore round 1

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

- The commit range changes no file under `client/godot/core/scene_core/` and no SceneCore spec line (`## spec changes` is `none`). The changed code that SceneCore reaches was read: `PoolCore` (`_lend`, `_add_skip`, `_flush_effect_skip`, `init`, `_reset`), `ScreenEffectCore` (`fade`, `flash`, `play_preset`, `_is_skipped`, `_skipped_handle`, `_reset_state`), `TweenCore` (`play_value`, `_set_property_record`, `_begin`, `_queue_end_due`, `_end_state`) and the `QACore` module switches (`_set_feedback_off`, `_set_reward_presentation_off`, `_apply_module_states`, `_set_module_state`)
- SceneCore calls only `PoolCore.prefill` (`client/godot/core/scene_core/scene_core.gd:335`) and `ScreenEffectCore.clear_owner` (`client/godot/core/scene_core/scene_core.gd:617`) of those modules, and neither changed in the range. The `World` skip does not apply to the `Transition` channel that the loading screen uses, and a skipped handle never becomes the current handle of a channel, so `clear_owner` of the loading screen owner and the transparent `Transition` overlay after a transition are unaffected. The effect skip changes only auto-return `borrow`, which SceneCore does not call; a take-back whose instance was destroyed by the stage 3 scope release is skipped by the `_instance_of` check
- The finite skip of `TweenCore` during the `QACore` reward window ends finite tweens that a loading screen root or scene code plays in `on_show`, `on_hide` or `on_start` at once; SceneCore awaits those callbacks and does not rely on their duration, and stage 8 measures `SceneCore.loadingMinDisplayMs` with `TimeCore` real elapsed time independently of tweens. This was checked by reading only
- The `QACore` callers of SceneCore (`change_scene` command at `client/godot/core/qa_core/dev/qa_builtins.gd:755`, `scene_key` and `in_transition` queries in `client/godot/core/qa_core/dev/qa_query.gd`) did not change in the range
- The SceneCore core tests were not run in this review: no finding needed a check, and `ogw review run` runs the core tests of the modules that depend on the changed modules
