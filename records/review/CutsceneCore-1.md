# CutsceneCore review round 1

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

- The commit range 97851fcb..476972c0 changes no file of `client/godot/core/cutscene_core/`. Its code changes are in UICore only (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`): the key direction input that starts the focus mode is no longer consumed and the focus is put in a deferred `_start_focus`, and a system popup body scroll that no UI element took is consumed in `_on_unhandled_input`. I checked these against the CutsceneCore code paths that use UICore: `set_view_focus` (`cutscene_core.gd:1906`, `:1950`), whose `_update_focus` call skips `grab_focus` while `_focus_start_pending` is set and is run again by `_start_focus` in the same frame; `_other_button_focused` (`cutscene_core.gd:1559`), which reads only the focus owner and is not reached by direction input; the cutscene pause popup opened with `UICore.open_system_popup` (`cutscene_core.gd:1742`), whose body scroll now consumes the up and down input, while CutsceneCore ignores input during a cutscene pause; and the block of reason tag `cutscene`, whose pass list holds no direction action, so the direction input that now goes on to the world stage reaches no gameplay action. I found no CutsceneCore behavior that these changes make differ from the defining documents
- `ogw core test godot CutsceneCore` passed; the tool reported the result as reused, so the run did not execute the tests again in this review
- CutsceneCore code that the changes of the range do not reach (step commands, skip, line history, data check) was not reviewed in full, since a commit range is given
