# review: VirtualPadCore round 1

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

- The commit range 97851fcb..0fac8a1d changes no VirtualPadCore file. It changes only UICore (client/godot/core/ui_core/ui_core.gd, client/godot/core/ui_core/system_popup_view.gd and their tests): the deferred focus mode start on a key direction input (`_start_focus`, `_focus_start_pending`) and the consumption of a system popup body scroll in `_on_unhandled_input` (`_scroll_event`). VirtualPadCore calls only `UICore.get_layer` (client/godot/core/virtual_pad_core/virtual_pad_core.gd:97) and `UICore.get_open_popup_count` (virtual_pad_core.gd:431, :470), which the range does not change. The changed UICore paths act only on key and joypad direction inputs, and VirtualPadCore handles only pointer input (virtual_pad_core.gd:509, :543); the layout and every element have `focus_mode = FOCUS_NONE` (virtual_pad_core.gd:302, :304, :829), so the deferred focus start cannot put the focus on a virtual pad element. A key direction input from `Touch` changes the input device to `KeyboardMouse` before and after the range alike, so the state change to `Hidden` is unchanged. No problem caused or revealed by the range was found.
- VirtualPadCore code outside its interaction with the changed UICore code was not reviewed, because a commit range was given and no VirtualPadCore code is in it.
- `ogw core test godot VirtualPadCore` (job mw4dy2gm399b4c) ran on the main checkout of open-game-works-core-impl at 58ba7147, a descendant of 0fac8a1d whose VirtualPadCore and InputCore files are the same as at 0fac8a1d and whose UICore differs only by a later change to `scroll_by` and its test. The module result was `skipped` with `render pass not run: the macOS screen is locked or the display sleeps`, which the Godot engine rules give only when the headless pass did not fail; the job status was `failed` with exit code 1. The render pass tests (tests/test_render_state.gd) were not run.
