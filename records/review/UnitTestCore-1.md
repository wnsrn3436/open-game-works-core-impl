# review UnitTestCore round 1

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

- The commit range 97851fcb..ac4b4282 changes no file of `client/godot/core/unit_test_core/`; it changes only `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd` and UICore tests. The review covered the UnitTestCore code that reaches UICore: `tap` (client/godot/core/unit_test_core/dev/unit_test_core.gd:1267) puts in only `InputEventMouseButton` events, which are not direction inputs, so the changed key direction focus start (`_focus_start_pending`, `_start_focus`) and the system popup scroll consumption (`_scroll_event` in `UICore._on_input` / `_on_unhandled_input`) do not change what it delivers; `tap_anchor` (client/godot/core/unit_test_core/dev/unit_test_core.gd:1281) calls `UICore.get_anchor_rect`, which the range does not change. The UnitTestCore tests that start UICore (client/godot/core/unit_test_core/tests/test_input.gd) put in no key direction input, and test_page_input.gd uses only key Q in a browser run
- Test setup step 1 releases UICore with `BootstrapCore.shutdown`; the new UICore statics (`_focus_start_pending`, `_start_focus_callable`, `_scroll_event`) are reset in `UICore._reset_statics`, and a deferred `_start_focus` left from the previous test returns at the `_is_initialized` check of `_update_focus` or runs on a new session where it only sets `_focus_start_pending` to its initial `false`, as the earlier deferred `_update_focus` did before the range. So the "a test does not depend on other tests" behavior of UnitTestCore is not changed by the range
- The UnitTestCore and UICore core tests were not run in this review: no finding needed a run to check it
- The UnitTestCore code outside the range was not reviewed again, because the commit range is not `none` and the input has no `## spec changes`, `## debt` or `## must fix` items
