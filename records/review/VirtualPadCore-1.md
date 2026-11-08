# review VirtualPadCore round 1

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

- The commit range 85f6b36d..91f65746 changes no file of `client/godot/core/virtual_pad_core/` and not `core-spec/VirtualPadCore.json`. The changes that reach the target are those of its dependencies: `client/godot/core/input_core/input_core.gd` (stick axis inversion and sensitivity, `InputCore.padAxisSensitivities`), comment-only changes of `client/godot/core/log_core/log_core.gd`, and the new keys of `client/godot/generated/core_settings.json`. The InputCore operations the target calls (`inject_action`, `get_cancel_count`, `get_device`, `has_action`, `is_initialized`, the UI pointer observer) are unchanged in the range. The stick axis options apply only to gamepad axis direction sources (`_axis_source_strength`, `_release_stick_axis`), and the inject source (`_source_stride - 1`) that VirtualPadCore presses is not one of them, so no virtual pad inject is changed by them. The new required setting `InputCore.padAxisSensitivities` is in the generated core settings, so InputCore `init` in the VirtualPadCore tests still succeeds
- `ogw core test godot VirtualPadCore` passed on this checkout (job mw7u7xbo19a879); it wrote no test record because the checkout had the uncommitted deletion of the earlier review file
- The code of the target that the range does not reach was not reviewed again: with a commit range, only problems the changes cause or reveal are in scope
