# SceneCore review round 1

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

- The commit range 97851fcb..1779eeec changes no file under `client/godot/core/scene_core/`. The only code changes are in `client/godot/core/ui_core/` (`ui_core.gd`, `system_popup_view.gd` and their tests): the focus mode started by a key direction input is now deferred through `_start_focus` / `_focus_start_pending`, and a system popup body scroll is consumed in `_on_unhandled_input` through `_scroll_event`
- Checked how those changes reach SceneCore: `client/godot/core/scene_core/` does not refer to `UICore._update_focus_callable`, `_start_focus`, `_focus_start_pending`, `_scroll_event`, `SystemPopupView.scroll_by` or any other UICore internal. Its only key input is `KEY_ESCAPE` in `client/godot/core/scene_core/tests/test_retry_popup.gd:112`, which is not a direction input and does not reach the changed branches of `UICore._on_input`. The retry popup is a system popup, so a down/up key while it is open may now be consumed by the body scroll in the unhandled input stage; SceneCore does not rely on that input reaching the world stage (the scene is stopped from stage 4 until stage 7, and the retry popup is open at stage 6)
- The SceneCore code outside the places the range reaches was not reviewed, because the commit range is not `none`
- The SceneCore core tests were not run: no change in the range alters SceneCore code or a behavior its tests check, and `ogw review run` runs the core tests of the modules depending on the changed module after each fix
