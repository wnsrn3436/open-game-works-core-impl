# NativeUiCore review round 1

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

- The commit range 97851fcb..6c7ffa69 changes no file under `client/godot/core/native_ui_core/`. The only client code it changes is `client/godot/core/ui_core/ui_core.gd` and `client/godot/core/ui_core/system_popup_view.gd`: the focus mode start by a key direction input, which is now deferred, and the consumption of the system popup body scroll in unhandled input. The rest of the range is UICore tests and review/update records. NativeUiCore calls UICore only through `UICore.get_layer(UICore.UILayer.DEBUG)` (`client/godot/core/native_ui_core/native_ui_core.gd:149`), which the range does not change (`client/godot/core/ui_core/ui_core.gd:299`). No NativeUiCore code path reaches `_on_input`, `_on_unhandled_input`, `_update_focus`, `_start_focus` or `scroll_by`. The NativeUiCore tests inject no key input and open no system popup: the only input is a browser page click in `client/godot/core/native_ui_core/tests/test_web_browser.gd:115`, which goes through the mouse branch of UICore and is not changed. So the range causes or reveals no NativeUiCore finding.
- The NativeUiCore tests were not run: GUT (`addons/gut`) is not installed in this worktree. `ogw review run` runs the core tests of the modules that depend on UICore.
- The rest of NativeUiCore (adapters, share, review, capture, clipboard, DEV) was read only to trace its use of UICore and was not checked against every aspect. With a commit range, problems that existed before the range and are unrelated to it are not findings.
