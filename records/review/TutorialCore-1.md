# review: TutorialCore round 1

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

- The commit range changes no file under `client/godot/core/tutorial_core/`. The only code change is in `UICore` (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`): the key direction input that starts the focus mode now puts the focus in a deferred `_start_focus` and is no longer marked handled, and a system popup body scroll is consumed in `_on_unhandled_input`. The places of TutorialCore that reach this code were read: `UICore.set_view_focus(Tutorial)` in `_set_focus` and `_clear_focus` (`client/godot/core/tutorial_core/tutorial_core.gd:987`, `client/godot/core/tutorial_core/tutorial_core.gd:1174`), the block pass list with `UICore.get_block_pass_list` (`client/godot/core/tutorial_core/tutorial_core.gd:1012`) and `UICore.is_system_popup_visible` (`client/godot/core/tutorial_core/tutorial_core.gd:883`, `client/godot/core/tutorial_core/tutorial_core.gd:1152`). None of them depends on the start input of the focus mode being marked handled or on the scroll input being consumed in `_input`, so no change of TutorialCore behavior was found.
- `ogw core test godot TutorialCore` passed (the result was reported as reused). The TutorialCore tests drive the view focus only with gamepad input (`client/godot/core/tutorial_core/tests/test_input.gd:152`, `client/godot/core/tutorial_core/tests/test_view.gd:225`); no TutorialCore test sends a key direction input that starts the focus mode during a step with a `Tutorial` view focus or a `tutorial` block, so how the engine handles that input, which now reaches the GUI and the world stage under the `tutorial` block, was checked only by reading the code, not by a run.
