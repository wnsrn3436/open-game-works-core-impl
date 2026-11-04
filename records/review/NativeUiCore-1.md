# NativeUiCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/native_ui_core/adapters/native_ui_plugin_adapter.gd:50 | Input D1 is still open. The only test plugin, `client/godot/core/native_ui_core/tests/support/silent_native_ui_plugin.gd:27`, always returns an empty array from `take_share_result`. `test_plugin_adapter.gd:32` therefore ends only through `release`, and `test_plugin_adapter.gd:59` ends at `start_share` returning 0 (line 42) on a headless macOS host. No test reaches the mapping at line 50 from `[0]` to `Closed` and from `[1]` to `Failed` that `open-game-works-core/skills/client-core/engines/godot.md:61` sets, or the "any other size gives `Failed`" branch at line 51. Swapping the two results at line 50 leaves every NativeUiCore test passing | Add a test plugin, preloaded like `SilentPlugin`, whose `take_share_result` returns `[0]` and then `[1]` after a frame. Assert that `NativeUiCore.share` gives `Closed` and then `Failed` with one error log | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/native_ui_core/adapters/native_ui_web_adapter.gd:56 | Input D2 is still open. `client/godot/core/native_ui_core/tests/test_web_browser.gd` replaces `navigator.share` only with a promise that never settles (`_OPEN_SHARE`, line 35). Its share tests are `test_the_browser_without_the_web_share_api_cannot_share` (line 158) and `test_release_ends_a_web_share_whose_window_stays_open` (line 170). No test settles `navigator.share`, rejects it with an `AbortError`, or rejects it with another error, so the mapping at line 39 and lines 56-59 never runs in a test | In the browser run, replace `navigator.share` with a function that resolves, one that rejects with `new DOMException("", "AbortError")`, and one that rejects with another error. Assert `Closed`, `Closed` and `Failed`, and an error log only for the last | no | 90 |
| R1-3 | test evidence | medium | client/godot/core/native_ui_core/native_ui_core.gd:150 | Input D3 is still open. `client/godot/core/native_ui_core/tests/test_render_capture.gd` has one test, which covers only the success path. `test_headless.gd:11` returns at line 144, and `test_lifecycle.gd:86` returns at the init check at line 142. No test runs lines 150-155 (no `Debug` layer, frame watch failure) or lines 307-309 and 314-315 (no image, PNG encoding failure). So the `capture_screen` failure row of the `## error` table of `open-game-works-core/skills/client-core/modules/native-ui-core.md` (empty bytes and an error log) has no test | Add a render test that calls `capture_screen` after `UICore.release()`. `UICore.get_layer` then returns `null` (`client/godot/core/ui_core/ui_core.gd:290`), and the test asserts empty bytes and one error log | no | 85 |
| R1-4 | spec | medium | client/godot/core/native_ui_core/dev/native_ui_core_dev.gd:13 | Input D4 is still open. `get_fake_record` casts the adapter to the global class name `FakeNativeUiAdapter` and reads its members `review_count`, `share_count`, `last_text` and `last_image_bytes` through that name (lines 13 and 17-20). `open-game-works-core/skills/client-core/engines/godot.md:432` requires DEV code to read a fake adapter's members through a `preload()` constant of that file, as `client/godot/core/push_core/dev/push_core_dev.gd:10` and `:23` do | Add `const _FAKE := preload("res://core/native_ui_core/dev/adapters/fake_native_ui_adapter.gd")` and cast to and read through `_FAKE` | no | 90 |
| R1-5 | correctness | medium | client/godot/plugins/ogw-native-ui/android/plugin/src/main/java/io/github/wnsrn3436/ogw/nativeui/OgwNativeUiPlugin.java:77 | Input D5 is still open. `request_review` puts `requestReviewFlow()` on the UI thread and returns `true` (line 77) before Google Play answers. A failed task returns at lines 71-73 with no report. `NativeUiPluginAdapter.request_review` (`client/godot/core/native_ui_core/adapters/native_ui_plugin_adapter.gd:28`) passes that `true` on, and `NativeUiCore.request_review` saves `last_review_at` and returns `Requested` (`client/godot/core/native_ui_core/native_ui_core.gd:127-129`). On a device where `requestReviewFlow` fails (e.g. no Play Store or no Play services), the device is throttled for `reviewMinIntervalMs` although Google Play accepted no request. `native-ui-core.md` `### store review request` step 4 says a reported failure saves nothing. Found by reading the code; not run on a device | Make the review request asynchronous end to end: a `start_review`/`take_review_result` pair in the plugin interface of `open-game-works-core/skills/client-core/engines/godot.md:61`, an async `NativeUiAdapter.request_review`, and `NativeUiCore.request_review` as an async operation in `native-ui-core.md`. The plugin reports failure when `requestReviewFlow` fails | yes | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | `silent_native_ui_plugin.gd:27` still returns only an empty array, and no other test plugin exists under `client/godot/core/native_ui_core/tests/`. `native_ui_plugin_adapter.gd:50-52` is unchanged |
| D2 | open | R1-2 | `test_web_browser.gd` still has only the never-settling `_OPEN_SHARE` stub and the no-API test. `native_ui_web_adapter.gd:38-39` and `:56-59` are unchanged |
| D3 | open | R1-3 | `test_render_capture.gd` holds one success-path test. Every other `capture_screen` call in the tests returns at line 142 or 144 |
| D4 | open | R1-4 | `native_ui_core_dev.gd:13` still casts with `as FakeNativeUiAdapter` and reads members at lines 17-20 |
| D5 | open | R1-5 | `OgwNativeUiPlugin.java:70-77` is unchanged. `native_ui_core.gd:124-129` saves `last_review_at` on `true` |

## must fix

none

## unknown

- The commit range `f8ed28b..f8ed28b` is empty, so there are no changed places. This round checked only the five input debt items against the current code. It did not look for new problems across the whole module
- I did not run the tests or restore the defects in a temporary copy. The `test evidence` items are judged from the test code: no test calls the paths listed
- I did not run R1-5 on an Android device. It is judged from reading the plugin source
- I did not check the iOS and macOS plugin sources (`ogw_native_ui.mm`) for the same early-return pattern as R1-5
