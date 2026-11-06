# review: MessageCore round 1

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

- The commit range 97851fcb..6c7ffa69 changes no MessageCore file. It changes only `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, UICore tests and records. MessageCore calls only `UICore.get_layer`, `UICore.get_block_pass_list` and the `UICore.dimOpacity` setting (`client/godot/core/message_core/message_core.gd:64`, `:380`, `:685`), and the range does not change any of them.
- Checked how the changed UICore input path (the deferred `_start_focus` for the key direction that starts focus mode, and `_scroll_event` being consumed in `_on_unhandled_input`) works with the black box block (reason tag `message`, pass list = the system popup root). While the block is active, `InputCore` still drops a key input whose focus owner does not pass (`client/godot/core/input_core/input_core.gd:583-591`). So the input that starts focus mode reaches no UI under the black box. A system popup body still scrolls because `InputBlockCore.pass_focus(_system_root)` passes (`client/godot/core/ui_core/ui_core.gd:2719`). A `_scroll_event` that `InputCore` discards stays until the next `_on_input` clears it, and that has no effect that MessageCore can observe. MessageCore tests press system popup buttons only by tap (`client/godot/core/message_core/tests/test_input.gd:52-55`). No test checks key or gamepad input through the black box. That gap predates the range.
- `ogw core test godot MessageCore`: pass. The job reported the result as reused from an earlier run with the same inputs.
- The rest of MessageCore was not reviewed again: it is outside the range and not touched by the changed code.
