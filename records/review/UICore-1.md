# review: UICore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/ui_core/ui_core.gd:2723 | `ui-core.md` focus rules: the direction input that started focus mode "is consumed in the UI stage of `InputCore` only when a UI element handles it otherwise (e.g. the scroll of a system popup body)", and the system popup body area scrolls only "when the body and extra text do not fit in the body area". `scroll_by` (client/godot/core/ui_core/system_popup_view.gd:146) returns `true` whenever the `ScrollContainer` exists, and `build` always creates it, so `_on_input` keeps every up/down input as `_scroll_event` while any system popup is shown and `_on_unhandled_input` (ui_core.gd:2741) consumes it before the `InputCore` world stage, also when the body fits and nothing scrolls. Reproduced in a temporary copy of the project (worktree HEAD core over a set-up copy of the core Godot project, GUT test file run alone): `open_system_popup(one_button_param())` (short body, max scroll position 0), `set_keys(cutscene_advance, ["Down"])`, device `KeyboardMouse`, focus mode off, inject a Down key press: scroll position stays 0 and `InputCore.is_pressed(&"cutscene_advance")` is `false`; with `_scroll_event = event` replaced by `pass` in that copy, the same run gives `true`. So a key direction input that starts focus mode over a short system popup does not press the action bound to that key although no UI element handled it | Keep the input as a scroll consumption only when the body actually scrolls (the content is longer than the body area, or the scroll position changed), e.g. make `scroll_by` return that, and add a test with a body that fits in which the starting input presses the action bound to that key | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- "in that frame" for the deferred `_start_focus`: the tests check that focus is set by the next `SceneTree.process_frame` with the process frame count advanced by one after an injected press (the core agent report lists this under `## unverified`). Whether engine-dispatched device input (dispatched before the main iteration) gets its deferred call flushed in a frame whose `Engine.get_process_frames()` equals the one seen in `_input` was not checked against the engine source.
- The reproduction of R1-1 ran GUT without the UnitTestCore pre/post run hooks (no test host), so settings reads logged errors; the scroll position, the max scroll position (0) and the action state were printed and compared with and without the consumption line in the same environment. The whole UICore suite and dependents were not run by this review.
- The engine's own handling of a ui direction action with no focus owner (that it moves or grabs no focus) was taken from the passing tests of the commit, not from the engine source.
