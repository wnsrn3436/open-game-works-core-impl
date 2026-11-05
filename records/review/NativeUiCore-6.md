# NativeUiCore review round 6

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R5-1 | fixed | `test_a_new_boot_with_the_device_time_set_back_past_the_interval_is_throttled` (client/godot/core/native_ui_core/tests/test_review.gd:66) gets `Requested` at `t`, sets the device time to `t - REVIEW_INTERVAL_MS - 1`, reboots, and asserts `Throttled`, `review_count` 0, `last_review_at` `t`. Restored defect in a temporary clone of this checkout: native_ui_core.gd:120 changed to `last != _NO_TIME and now - last >= 0 and now - last < _review_min_interval_ms`. `ogw core test godot NativeUiCore --file client/godot/core/native_ui_core/tests/test_review.gd` failed on that test: `[0] expected to equal [1]: a new boot with the device time set back; [1] expected to equal [0]; [1699913599999] expected to equal [1700000000000]` |
| R5-2 | fixed | `_check_two_captures_in_one_frame` (client/godot/core/native_ui_core/tests/test_render_capture.gd:96, called by :54 and :58 with the `Debug` layer shown and hidden) starts two captures in one frame, turns the layer below blue when the first returns, and asserts equal bytes (:108), a green center and the `Debug` layer visibility from before the first call (:110). Restored defects in temporary clones, run with `ogw core test godot NativeUiCore --web` (the native render pass does not run here, see `## unknown`): (a) `_show_hidden_layer` sets `visible = true` instead of `_hidden_layer_visible` (native_ui_core.gd:321) → `test_two_captures_in_one_frame_..._hidden_debug_layer` failed `[true] expected to equal [false]`; (b) `_on_frame_post_draw` (native_ui_core.gd:277-285) resumes only the first wait and leaves the others for the next drawn frame → both two-capture tests failed `the same frame` and the green-center assert. The unmutated clone passed the same browser run |
| R5-3 | fixed | `test_capture_after_an_earlier_one_returned_gets_a_frame_drawn_after_it` (client/godot/core/native_ui_core/tests/test_render_capture.gd:62) captures green, turns the layer below blue, captures again and asserts a blue, not green, center. Restored defect in a temporary clone: `_on_frame_post_draw` keeps the first read PNG in a static var and returns it to later waits. `ogw core test godot NativeUiCore --web` failed on that test: `[0.0] expected to be > than [0.5]: the second capture is drawn after the change; [1.0] expected to be < than [0.5]` |
| R5-4 | fixed | `_check_release_during_a_capture` (client/godot/core/native_ui_core/tests/test_render_capture.gd:115, called by :75 and :79) starts a capture without awaiting, calls `NativeUiCore.release()`, and asserts one return (:123) with empty bytes (:126), the `Debug` layer visibility from before the call (:127), and no error or warn log (:129). Restored defects in temporary clones, `ogw core test godot NativeUiCore --web`: (a) the `for wait in capture_waits: wait.finish()` loop of `_clean_up` (native_ui_core.gd:348-349) made a no-op → both release tests failed `[0] expected to equal [1]: the capture returned once`; (b) `_show_hidden_layer()` in `_clean_up` (native_ui_core.gd:332) replaced by `_hidden_layer = null` → `..._shown_debug_layer` failed `[false] expected to equal [true]`; (c) the `visible = true` mutation of R5-2 (a) → `..._hidden_debug_layer` failed `[true] expected to equal [false]` |
| R5-5 | fixed | `assert_eq(warns(), 0)` added at client/godot/core/native_ui_core/tests/test_lifecycle.gd:55. Restored defect in a temporary clone: `LogCore.log_warn(_TAG, "mutant")` before `share_wait.finish()` in `_clean_up` (native_ui_core.gd:346). `ogw core test godot NativeUiCore --file client/godot/core/native_ui_core/tests/test_lifecycle.gd` failed: `test_release_during_a_share_ends_it_failed_and_init_again_has_no_adapter: [1] expected to equal [0]` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range `1717513..c3321fa` only NativeUiCore tests changed (test_lifecycle.gd, test_render_capture.gd, test_review.gd); module code and the plugin did not change. I read the changed tests against native-ui-core.md `### screen capture`, `### release`, `## error` and `## test`, and found no new problem
- The temporary clones had to be placed under `worktrees/_core/` because `ogw core test` run elsewhere resolves the main checkout of `open-game-works-core-impl/` instead of the current folder (a first run from the scratchpad clone passed on the unmutated main). The clones were deleted after the runs
- The native render pass did not run on this host (`render pass not run: the macOS screen is locked or the display sleeps`). The render mutations of R5-2, R5-3 and R5-4 were judged by the browser run (`--web`, Web export renderer), not in a native window
- The places listed in `## unknown` of records/review/NativeUiCore-5.md stay unchecked: the Android `request_review` success timing on a device (OgwNativeUiPlugin.java:59-78) and the iOS and macOS plugin builds
