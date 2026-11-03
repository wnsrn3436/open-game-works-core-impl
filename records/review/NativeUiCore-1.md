# review NativeUiCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/native_ui_core/adapters/native_ui_plugin_adapter.gd:50: medium `test evidence`: no test goes through the mapping of `take_share_result` to `Closed` and `Failed`, which `open-game-works-core/skills/client-core/engines/godot.md:61` sets. `test_plugin_adapter.gd` only uses a plugin whose window never closes and, on macOS headless, a `start_share` that returns 0. In a temporary copy with `_STATUS_CLOSED` set to 1, so that a closed window gives `Failed` and a failed share gives `Closed`, the headless pass of `ogw core test godot NativeUiCore` did not fail. The render tests do not use this adapter. A test plugin that gives `[0]` and `[1]` would cover it
- client/godot/core/native_ui_core/adapters/native_ui_web_adapter.gd:56: medium `test evidence`: no test goes through the end of a Web Share: a resolved `navigator.share`, an `AbortError` rejection or another rejection. `test_web_browser.gd` only covers a browser without the API and a `release` during an open share. In a temporary copy where a normal end no longer gives `Closed` (line 56 compares with `"never"`) and every rejection at line 39 reports `"0"`, `ogw core test godot --web NativeUiCore` printed `pass`
- client/godot/core/native_ui_core/native_ui_core.gd:150: medium `test evidence`: the error row `capture_screen` failure of `open-game-works-core/skills/client-core/modules/native-ui-core.md` has no test. `test_render_capture.gd` holds one test, which is the success path, and the headless tests return at line 144 before this code. So lines 150-155 (no `Debug` layer, frame wait failure) and lines 308 and 315 (no image, PNG failure) never run in a test. Line 150 can be reached in a render test by calling `capture_screen` after `UICore.release`, because `UICore.get_layer` then returns `null` (`client/godot/core/ui_core/ui_core.gd:290`)
- client/godot/core/native_ui_core/dev/native_ui_core_dev.gd:13: medium `spec`: `NativeUiCoreDev` reads the members of the fake adapter through `class_name` `FakeNativeUiAdapter` (lines 17-20), while `open-game-works-core/skills/client-core/engines/godot.md:432` requires DEV code to read them through a `preload()` constant of that file, as `client/godot/core/push_core/dev/push_core_dev.gd:10` does. The type check that the rule protects was not run for this line
- client/godot/core/payment_core/dev/payment_core_dev.gd:67: medium `spec`: `PaymentCoreDev` has the same difference from `open-game-works-core/skills/client-core/engines/godot.md:432`: it casts to `class_name` `FakeStoreAdapter` and reads and writes its members (e.g. `fake.next_buy_result` at line 12). Seen while checking the rule for NativeUiCore. The other files of PaymentCore were not checked for it
- client/godot/plugins/ogw-native-ui/android/plugin/src/main/java/io/github/wnsrn3436/ogw/nativeui/OgwNativeUiPlugin.java:77: medium `correctness`: `request_review` returns `true` before Google Play answers, and lines 71-73 drop a failed `requestReviewFlow` with no report. On a device where that task fails, `NativeUiCore.request_review` returns `Requested` and saves `last_review_at` (`client/godot/core/native_ui_core/native_ui_core.gd:127`), so the device is throttled for `reviewMinIntervalMs` (default 30 days) although no request was accepted. `open-game-works-core/skills/client-core/modules/native-ui-core.md` says a reported failure saves nothing. Found by reading the code and not run on a device. The fix needs a spec change, because `open-game-works-core/skills/client-core/engines/godot.md:61` and `NativeUiAdapter.request_review` are synchronous while this answer is asynchronous

## debt

none

## must fix

none

## unknown

- The commit range changes no file of NativeUiCore (`client/godot/core/native_ui_core/`, `client/godot/plugins/ogw-native-ui/`, `core-spec/NativeUiCore.json`) and no file of `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore` or `UICore`. The range changes to `client/godot/generated/core_settings.json` and its type file do not touch the `NativeUiCore.*` keys. The problems above existed before the range, so they are in `## out of scope`
- How the runs were made: temporary clones of the range head under `worktrees/_core/`, deleted after the runs, because `ogw core test` uses the folder it runs in only there. As a control, a copy with `text.length() >= _share_text_max_chars` printed `NativeUiCore fail` with `test_text_length_counts_code_points`, so the runs used the changed copy. Both native adapter defects (plugin and web) were present together in each mutated run and were not run alone
- `ogw core test godot NativeUiCore` on the unchanged range head passed its headless pass, and the result was `skipped` with `render pass not run: the macOS screen is locked or the display sleeps`. So `test_render_capture.gd` and `test_render_clipboard.gd` were not run in this review, and capture and clipboard behavior on a real window was checked only by reading the code
- The `--web` run was made on the mutated copy, and on the main checkout (a later commit than the range head) by mistake when a clone outside `worktrees/_core/` fell back to it; that run printed `pass`. No `--web` run was made on the unchanged range head. The three earlier native runs from outside `worktrees/_core/` also tested main, and they are not used as evidence
- The Android, iOS and macOS plugin code was read but not run on a device or with a real share window, apart from the macOS headless `start_share` case of `test_plugin_adapter.gd`. Whether `dist/` of `ogw-native-ui` was built from the current plugin source was not checked
- `capture_screen` while the engine draws no frame (a minimized or occluded desktop window) was not run. By reading, it waits for the next drawn frame with the `Debug` layer hidden and has no time limit. The spec sets no duration for this case, unlike the `QACore` fallback at `open-game-works-core/skills/client-core/engines/godot.md:392`, and it was not judged a defect
