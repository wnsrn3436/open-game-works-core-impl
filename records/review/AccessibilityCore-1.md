# review AccessibilityCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/accessibility_core/accessibility_core.gd:117: medium `spec`. `## DEV` of `accessibility-core.md` says of `set_test_text_scale` "On `release` it returns to the saved value", but `release` does not touch the text scale, and `client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:17` keeps no value to return to. Reproduced with a test in a temporary copy: `set_text_scale`(1250), `set_test_text_scale`(1500), `AccessibilityCore.release()`, then `LocalizationCore.get_text_scale()` is 1500, not 1250. The value stays until `LocalizationCore.release` (back to 1000) or the next `apply_saved_settings`. No core test checks this DEV behavior. The code has not changed in the commit range
- client/godot/core/accessibility_core/accessibility_core.gd:111: medium `test evidence`. The error row "engine does not support a full-screen shader: applies no filter, warn once per `init`" has no test. `client/godot/core/accessibility_core/tests/` has no reference to that warning or to `_SCREEN_SHADER_METHODS`, the method list at `accessibility_core.gd:108` is a constant, and the headless pass reports the rendering method `forward_plus` (printed by a probe test), so no test takes this branch. `warns()` is only ever asserted to be 0. The code has not changed in the commit range

## debt

none

## must fix

none

## unknown

- Render pass: not run. `ogw core test godot AccessibilityCore` printed `AccessibilityCore skipped` (`render pass not run: the macOS screen is locked or the display sleeps`), and `ogw job status` reported that job as `failed`. The reason for the `failed` status was not checked beyond that skip line. The 3 tests of `client/godot/core/accessibility_core/tests/test_render_color_filter.gd` did not run, so the filtered pixel values and the loading icon pixels are not checked as drawn on a screen. The shader and those tests were only read
- Headless pass: the job output gave no test count, so the 37 headless tests were also run with GUT directly on a temporary copy of `client/godot` with the unchanged module source. In that run all 37 passed, and the only failure was the probe test of the first `## out of scope` line
- Effect of the commit range on the target: `client/godot/core/accessibility_core/`, the spec and the 11 `AccessibilityCore.*` settings have no change in the range. The range changes that could reach the target were read: `QACore._read_settings` no longer checks `AccessibilityCore.textScales`, which `AccessibilityCore.init` and the core settings schema still check; the QACore `set_text_scale` command still calls `set_test_text_scale` (`client/godot/core/qa_core/dev/qa_builtins.gd:263`); `LocalizationCore.list_languages`, `MessageCore.show_black_box` and the `BootstrapCore` tests have no call into the target. QACore and other module tests were not run
- Candidate checked and not written: a subtitle hidden one frame late. A temporary copy with that defect failed `test_subtitle_hides_in_the_frame_after_its_voice_is_stopped`, so the tests catch it
- Spec reading not settled: when `play_voice` with an empty subtitle key or a voice that did not start is called while another subtitle is visible, the code keeps the visible subtitle (`client/godot/core/accessibility_core/accessibility_core.gd:243`). `accessibility-core.md` says that request "shows no subtitle" and that a new subtitle replaces the previous one, and does not say whether a request with no subtitle hides the previous one. It is not written as a finding because neither reading is set by the documents
- Godot behavior when another shader in the `LoadingIcon` layer reads the screen texture: the engine copies the screen once per canvas, so that shader and the filter could share a copy. No core or game code that does this was looked for, and it was not reproduced
- `client/godot/core/ui_core/ui_core.gd:2802` moves a `CanvasLayer` for the keyboard shift, which would also move a filter on that layer. It only applies to a layer holding a focused text input element, and `LoadingIcon` has none in core. A content text input on that layer was not looked for
- Browser runtime: `ogw core test godot AccessibilityCore --web` was not run
