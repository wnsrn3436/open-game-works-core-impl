# review: AccessibilityCore round 1

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

- The commit range 97851fcb..37049e4d changes only `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, UICore tests and a record. It changes no AccessibilityCore code or test. AccessibilityCore uses UICore only through `UICore.get_layer(MESSAGE)` and `UICore.get_layer(LOADING_ICON)` (`client/godot/core/accessibility_core/accessibility_core.gd:95-96`), and its tests use `UICore.init`, `UICore.prepare`, `UICore.show_loading_icon` and `UICore.hide_loading_icon`; none of these is changed in the range. The changed paths (`_on_input`, `_on_unhandled_input`, `_update_focus`, `_start_focus`, `scroll_by`) handle key direction input, focus and system popup scrolling, and the AccessibilityCore subtitle box and color filter take no input and no focus (`accessibility_core.gd:411`, `:415`, `:437-438`; `Label` and `ColorRect` have no focus by default). So no AccessibilityCore problem caused or revealed by the range was found
- The AccessibilityCore core tests were not run in this review. The report `records/1793932803677-update-core-mw4d9u8t750c0d.md` states that its last `ogw core test godot` run skipped the render pass of AccessibilityCore (`tests/test_render_color_filter.gd`) because the macOS screen was locked, and that the `--web` run passed it; that desktop render pass after the range was not checked
- Code of AccessibilityCore outside the places the range reaches was not reviewed, because a commit range is given
