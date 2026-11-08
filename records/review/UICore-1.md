# review UICore round 1

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

- The commit range 85f6b36d..0806d79e changes no file under `client/godot/core/ui_core/` and does not change `skills/client-core/modules/ui-core.md`. The review covered the changed dependency code that UICore calls: `InputCore` (stick axis inversion and sensitivity, `_axis_hits`, `_press_axis`, `_release_axis`, `_axis_presses_action`), `TimeCore` (`make_random_seed`, DEV frame step), `SoundCore` (`reset_volume_settings`, random seeds), `LogCore` (comments only), and the generated core settings. UICore calls `InputCore.is_just_pressed`, `is_just_released`, `has_action`, `get_cancel_count`, `get_keys`, `get_pad_buttons`, `set_back_handler`, `TimeCore.is_synced`, `is_reached`, `get_next_day_boundary`, `get_current_day`, `get_real_time` and `SoundCore.play`; the signatures and results of these calls did not change in the range, and UICore uses no random seed
- `ogw core test godot UICore` passed on this checkout (job mw7uforb31cf90). No test record was written because the checkout had an uncommitted change (the deleted earlier review file)
- Not checked to a reproduction: `client/godot/core/ui_core/ui_core.gd:2277` `_axis_press_passes` mirrors the blocked-state pass of `InputCore` by matching the raw axis direction of the event (`_is_binding_of`, `ui_core.gd:2311`) against the binding names. Since this range, `InputCore._axis_hits` judges a `Gameplay` action's stick axis source by the inverted direction (`client/godot/core/input_core/input_core.gd` `_axis_source_strength`), so the two can differ when `ui_accept` is bound to a stick axis direction, a passed `Gameplay` action is bound to the opposite direction of the same stick axis, and that axis is inverted. No observable wrong click was reproduced for this binding, so it is not written as a finding (confidence below 80)
- The other UICore code was not reviewed again, because it is outside the changes of the range
