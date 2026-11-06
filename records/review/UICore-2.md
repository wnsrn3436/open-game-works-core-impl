# review: UICore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `scroll_by` (client/godot/core/ui_core/system_popup_view.gd:147) now returns `false` without moving the scroll position when the max value minus the page of the vertical scroll bar is 0 or less, so `_on_input` (client/godot/core/ui_core/ui_core.gd:2722) no longer keeps an up or down input as `_scroll_event` over a body that fits, and `_on_unhandled_input` (ui_core.gd:2741) does not consume it before the `InputCore` world stage. A body that does not fit still returns `true` and is consumed (`_assert_focus_start_scrolls`, `test_scroll_with_direction_input`). The new test `test_key_direction_that_starts_the_focus_mode_over_a_body_that_fits_is_not_consumed` (client/godot/core/ui_core/tests/test_system_popup.gd:276) is the round-1 reproduction (short body, `cutscene_advance` on `Down`, `KeyboardMouse`, injected Down press) and asserts that the scroll position stays 0 and `InputCore.is_pressed(&"cutscene_advance")` is `true`; round 1 showed that the old behavior gives `false` in this run. `ogw core test godot UICore --file client/godot/core/ui_core/tests/test_system_popup.gd` passed (two passes reported) on open-game-works-core-impl HEAD, whose `ui_core` and `input_core` folders do not differ from the reviewed commit 58ba7147 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Up or down input in the same frame that the system popup is built, before the engine first lays out the `ScrollContainer` (max value and page of the scroll bar not set yet), was not checked. `scroll_by` would treat a long body as fitting in that case. The core agent report lists this under `## unverified`. Whether engine input can arrive between the build and the deferred container sort was not checked against the engine source.
- At the scroll end of a body that does not fit, a direction input is still consumed although the position does not move. This review takes that as the body area handling the input (`ui-core.md` system popup scroll rule and the `## test` item "at the end the scroll position is unchanged") and did not write it as a finding.
- The new test was not run against code with the fix reverted in this round. The failing result with the old behavior comes from the round-1 reproduction of the same run.
- The other files changed in the commit range are review records of other modules and the core agent report, and were not reviewed as UICore code.
