# review: GameUpdateCore round 1

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

- The commit range 97851fcb..476972c0 changes no GameUpdateCore file. It changes only UICore (`client/godot/core/ui_core/ui_core.gd` focus mode start input and system popup body scroll consumption, `client/godot/core/ui_core/system_popup_view.gd` `scroll_by` return value) and its tests, plus records. GameUpdateCore reaches these changes only through `UICore.open_system_popup` in `client/godot/core/game_update_core/game_update_core.gd:682` (`_show_popup`), whose parameters, button callbacks and hidden callback did not change. No GameUpdateCore code or test calls `scroll_by`, `_update_focus`, the focus mode or key direction input. The behavior of key direction input on the update popups belongs to the UICore review and was not checked here.
- `ogw core test godot GameUpdateCore` passed on this checkout. The `--web` run was not run in this review; the core agent report of the range states it passed for UICore and every dependent.
- GameUpdateCore code outside the range (deploy list, signature, file update, popups) was read only where it calls UICore; it was not reviewed as a whole because the commit range is not `none`.
