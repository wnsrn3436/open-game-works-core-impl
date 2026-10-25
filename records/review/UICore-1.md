# review: UICore round 1

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

- The commit range `d4e2728..4f38c49` changes UICore only by adding `is_flow_in_progress` (`client/godot/core/ui_core/ui_core.gd:653-665`), its entry in `core-spec/UICore.json:259-262` and two core tests (`client/godot/core/ui_core/tests/test_popup.gd:315-371`) plus the memory check (`test_popup.gd:302`, `:308`). The review checked it against `ui-core.md` (API row of `is_flow_in_progress`, `### panel stack`, `### popup`, `### system popup`, `## test` first item):
  - Panel transition: `_flow` is set at the start of `_transition` and cleared when `run_blocked` returns (`ui_core.gd:1151`, `:1156`); a cancel by `reset_panel_stack` or `release` ends the wait at once through `call_waiter.gd` `cancel`, which emits `done` synchronously.
  - Popup queue and open flow: a request is in `_queue` until `_pump_popups` moves it to `_open_record` (`ui_core.gd:1531-1536`), and `_open_record` is cleared only in `_finish_open` (after the open tween, `:1634`) or `_fail_open` (`:1656`). In the frame where `_finish_open` resolves the first popup before `_pump_popups` runs, the `_queue` check keeps the result `true`; `test_flow_in_progress_follows_the_flows` asserts exactly that moment ("the queued popup in its open flow"), since `wait_result` resumes synchronously on the emit.
  - Popup close and system popup open and close: `OPENING` and `CLOSING` states of `_shown_normal` and `_shown_system` (`ui_core.gd:527`, `:561`, `:1601`); the test covers the system popup open tween and close tween with `UICore.systemPopupResource` set to the tween popup.
  - During the hidden callback and the after-close callback of `close_popup` (`ui_core.gd:584-590`) the record is already removed, so `is_flow_in_progress` is `false` if called from inside those callbacks. Whether "until the close ends" in `ui-core.md:418` includes those synchronous callbacks is not settled by the spec; no frame can observe the difference, so it is not written as a finding.
- In the same range the dependencies of UICore change only in `TweenCore` (`get_finite_playing_count` added, `tween_core.gd:326-337`, and new tests). UICore does not call it and the play paths UICore uses are unchanged. `client/godot/generated/core_settings.json` renames `uiQuality.settleMs` to `uiQuality.settleLimitMs` and adds `QACore` and `UnitTestCore` keys; no UICore code reads them.
- The UICore core tests were not run in this review: the checkout has no GUT addon and no Godot import cache, and running Godot in it would write files into the target checkout.
- The caller side of `is_flow_in_progress` (`QACore` `ui_flow`, `qa-core.md:169`) is not implemented in this range and is the scope of the `QACore` review.
