# VirtualPadCore review round 6

## findings

none

## previous

none (round 5 has no findings and no `open` rows in `## previous`)

## out of scope

none

## debt

none

## must fix

none

## unknown

- No file of `client/godot/core/virtual_pad_core/` changed in the commit range. I read the changes of the modules it calls. `input_core.gd:665` changes only a comment. In `ui_core.gd`, system popups whose tween presets are still loading are kept in `_loading_system` and are not counted by `get_open_popup_count` (:664), which matches "number of visible popups" (ui-core.md:47). The `ui` input block of `open_popup` and `open_system_popup` is still set before any wait (:1605, :519). So the state rule of virtual-pad-core.md (`Inactive` when the count is 1 or more) and the input cancel that VirtualPadCore relies on while a popup opens are unchanged. The SceneCore changes touch only the scene holder, which does not hold the `VirtualPad` layer
- The spec changes (godot.md SceneCore, CameraCore, LocalizationCore, NativeUiCore and RealtimeCore rows; ui-core.md open failure rows and system popup areas; core SKILL.md `## spec`; command.md spec review input) do not change a behavior that VirtualPadCore defines or uses
- `ogw core test godot VirtualPadCore` ran only the headless pass (`VirtualPadCore skipped`, `render pass not run: the macOS screen is locked or the display sleeps`). So `tests/test_render_state.gd` was not run. `--web`, on-device touch and the dependents QACore and BootstrapCore were not run
- Debt item D2 of the VirtualPadCore debt list (records/review-debt/VirtualPadCore.json; a `Hidden` pad keeps its element `Control`s `is_visible_in_tree()` for `QACore.list_ui` and the `InputBlockCore` pass list) is still present: `virtual_pad_core.gd:445` is unchanged. It is not in the input `## debt`, and it is already on the list, so I did not write it again in `## out of scope`
