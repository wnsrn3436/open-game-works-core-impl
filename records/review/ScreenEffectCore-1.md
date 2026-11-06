# ScreenEffectCore review round 1

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

- The commit range 97851fcb..6461424b changes no file of `client/godot/core/screen_effect_core/`. Its client changes are in UICore only (`client/godot/core/ui_core/ui_core.gd`, `system_popup_view.gd` and their tests): the key direction input that starts the focus mode now puts the focus deferred and no longer marks the input as handled, and a system popup body scroll is consumed in the unhandled input stage. ScreenEffectCore uses only `UICore.get_layer` and `UICore.UILayer` (`client/godot/core/screen_effect_core/screen_effect_core.gd:36`, `:313`), which the range does not change, and its overlays are `ColorRect`s with `MOUSE_FILTER_IGNORE` and no focus, so the changed focus and scroll paths do not reach them. `ogw core test godot ScreenEffectCore` passes on the range end (the harness reused the result for an unchanged tree).
- Also read `screen_effect_core.gd`, `screen_effect_core_node.gd`, `screen_effect_handle.gd` and the tests `test_overlay.gd`, `test_handle.gd`, `test_lifecycle.gd` against the spec for problems outside the range; none of `critical`, `high` or `medium` was found. `wait_result` after `release` returning `Failed` with an error log follows the core rule for calls after `release` (`skills/core/SKILL.md:75`, harness repo).
- `test_input_check.gd`, `test_playback.gd`, `test_cleanup.gd`, the DEV code under `dev/` and the TweenCore behavior that ScreenEffectCore relies on (`check_definition`, time basis, `skip_to_end`) were not read in full, since the range does not change them or the code that calls them.
