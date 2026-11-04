# NativeUiCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New `client/godot/core/native_ui_core/tests/test_plugin_adapter.gd:63` `test_the_plugin_reply_of_a_closed_share_window_gives_its_share_result` uses `tests/support/closing_native_ui_plugin.gd`, which replies `[0]`, `[1]`, `[0, 0]`, and asserts `Closed`, `Failed`, `Failed` and the error log counts. Restored in a temporary detached worktree of HEAD `9d932f6` (under `worktrees/_core/`, since removed): `native_ui_plugin_adapter.gd:50` changed to `FAILED if raw[0] == _STATUS_CLOSED else CLOSED`. `ogw core test godot NativeUiCore` headless pass and `--web` browser run both failed this test (`[3] expected to equal [0]: [0] is a closed window`, `[0] expected to equal [3]: [1] is a failure`) |
| R1-2 | fixed | New `client/godot/core/native_ui_core/tests/test_web_browser.gd:203` `test_a_web_share_that_ends_gives_its_share_result` replaces `navigator.share` with one that resolves, rejects with `AbortError`, then rejects with `NotAllowedError`, and asserts `Closed`, `Closed`, `Failed`. `_PUT_BACK` (line 20) restores `share` and `canShare`. Restored the D2 defect in the same temporary copy: `native_ui_web_adapter.gd:39` reports `"0"` for every rejection and line 56 compares with `"never"`. `ogw core test godot --web NativeUiCore` failed this test (`[3] expected to equal [0]: a share that resolves`, `[3] expected to equal [0]: a share the user cancelled (AbortError)`) |
| R1-3 | fixed | New `client/godot/core/native_ui_core/tests/test_render_capture.gd:39` `test_capture_without_the_debug_layer_is_empty_with_an_error_log` calls `capture_screen` after `UICore.release()` and asserts empty bytes and one NativeUiCore error log. Restored in the same temporary copy: the `log_error` at `native_ui_core.gd:151` removed. The `--web` browser run failed this test (`[0] expected to equal [1]`). The native render pass did not run (the macOS screen was locked or the display slept). The frame watch failure (`native_ui_core.gd:153-155`), no screen image (`:307-309`) and PNG failure (`:314-315`) still have no test, but the `## error` row `capture_screen` failure of `native-ui-core.md:114` sets one result and one log for every failure, and this test goes through that failure path and checks both |
| R1-4 | fixed | `client/godot/core/native_ui_core/dev/native_ui_core_dev.gd:9` adds `const _FAKE := preload("res://core/native_ui_core/dev/adapters/fake_native_ui_adapter.gd")`. Line 17 casts to `_FAKE` and lines 21-24 read the members through it. No other DEV or test file reads members of the fake adapter through `FakeNativeUiAdapter`: `tests/test_lifecycle.gd:58` and `:71` only declare the type and compare the object |
| R1-5 | fixed | Harness commit `52e5ea3` added `open-game-works-core/skills/client-core/modules/native-ui-core.md:62`: on `android` the request counts as made when it is handed to the Google Play In-App Review flow, the adapter reports success then, and a later failure of the Google Play flow is not reported and changes nothing. `OgwNativeUiPlugin.java:59-77` returns `false` with no activity or when `ReviewManagerFactory.create` throws, and `true` after it hands `requestReviewFlow` to the UI thread. `native_ui_core.gd:124-129` saves `last_review_at` only on `true`. This now equals the defining document |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1 in `## previous`: the new test fails when the `[0]`/`[1]` mapping of `native_ui_plugin_adapter.gd:50` is swapped |
| D2 | fixed | none | Same as R1-2 in `## previous`: the new browser test fails with the D2 defect restored at `native_ui_web_adapter.gd:39` and `:56` |
| D3 | fixed | none | Same as R1-3 in `## previous`: the new test goes through the `capture_screen` failure path at `native_ui_core.gd:150-152` and fails in the browser run when its error log is removed |
| D4 | fixed | none | Same as R1-4 in `## previous`: `native_ui_core_dev.gd:17-24` reads the fake adapter through the `preload()` constant `_FAKE` |
| D5 | fixed | none | Same as R1-5 in `## previous`: `native-ui-core.md:62` now defines the `android` request as made at handoff, which the plugin and `native_ui_core.gd:124-129` follow |

## must fix

none

## unknown

- The native render pass did not run in the restore check because the macOS screen was locked or the display slept. R1-3 was shown in the browser run only
- I did not run the NativeUiCore tests on the unchanged HEAD. The core agent report says the native and `--web` runs pass
- R1-5 was not run on an Android device; it is judged from the plugin source and the current spec
- I did not check the iOS and macOS plugin sources (`ogw_native_ui.mm`)
- In the commit range, only the five files of commit `239ee61` under `client/godot/core/native_ui_core/` and the `records/` files belong to this target. The changes to `client/godot/core/push_core/` and the server core files in the range belong to other targets and were not reviewed
