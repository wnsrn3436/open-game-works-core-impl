# review: NoticeCore round 1

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

- The commit range changes no NoticeCore file. It changes only UICore (`client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/system_popup_view.gd`, UICore tests) and review records of other modules. The NoticeCore code it reaches is the maintenance popup that `client/godot/core/notice_core/notice_core.gd:584` opens with `UICore.open_system_popup` (one button, `back_button = -1`, extra text from the first active `Maintenance` notice). The changed UICore paths are the focus start of a key direction input (`_focus_start_pending`, `_start_focus`) and the consumption of a direction input that scrolls the top system popup body (`_scroll_event`, `scroll_by` now returning bool). NoticeCore calls neither `scroll_by` nor any focus API, and its hidden callback path (`_on_popup_hidden` → `settle_popup` → `_settle_popup`) does not depend on input handling. `test_back_input_does_not_close_the_maintenance_popup` (`client/godot/core/notice_core/tests/test_maintenance.gd:24`) injects Escape, which is not a `ui_up`/`ui_down`/`ui_left`/`ui_right` direction, so the changed branch of `UICore._on_input` does not run for it.
- Nothing in the NoticeCore spec covers direction input on the maintenance popup, so no NoticeCore test was expected to cover the new scroll consumption. That behavior belongs to the UICore review.
- `ogw core test godot NoticeCore` passed, but its output says `pass (reused)`, so it may be a cached result and not a fresh run against this checkout. The `--web` run was not done in this review. The core agent report for the UICore change says every dependent of UICore, NoticeCore included, passed in both runs.
- NoticeCore code outside the paths above (fetch, cache TTL, active judgement, badge, read state, image download, release) was not reviewed again, because the range does not change it or anything it calls.
