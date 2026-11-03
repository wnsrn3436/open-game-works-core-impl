# review: AccessibilityCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/accessibility_core/tests/test_saved_settings.gd:50: medium `test evidence`. The only test that asserts a saved text scale reaches `LocalizationCore` does not fail when `apply_saved_settings` stops applying it. The test calls `set_text_scale(1500)`, then `AccessibilityCore.release()` (line 44) and `init`, and does not release `LocalizationCore`. `AccessibilityCore.release` does not touch `LocalizationCore`, so `get_text_scale` is still 1500 at line 50 with `_apply_text_scale()` removed from `client/godot/core/accessibility_core/accessibility_core.gd:154`. No other test covers this path: `test_saved_values_out_of_their_allowed_values_are_the_default_without_a_log` expects 1000, which is also the value without the call, and the tests of `bootstrap_core` do not read the text scale. So a text scale saved on the device could stop being applied at boot with every test passing. Run path from reading the code; see `## unknown` for the mutation run.
- open-game-works-core/skills/client-core/modules/accessibility-core.md:142: medium `spec`. DEV says that after `set_test_text_scale`, "On `release` it returns to the saved value", and no test checks it. `### release` (line 83) says the value passed to `LocalizationCore` is reverted by the `release` of that module, and `LocalizationCore.release` sets 1000 (`open-game-works-core/skills/client-core/modules/localization-core.md:119`), not the saved value. Run path: `set_text_scale(1250)`, `AccessibilityCoreDev.set_test_text_scale(1500)`, `AccessibilityCore.release()` leaves `get_text_scale` at 1500; with `LocalizationCore.release()` as well it is 1000 after a new `LocalizationCore.init`. It is 1250 only after the next `AccessibilityCore.init` and `apply_saved_settings` (`client/godot/core/accessibility_core/accessibility_core.gd:117`, `client/godot/core/accessibility_core/accessibility_core.gd:154`). The two sentences of the spec give different values for the time right after `release`.
- client/godot/core/accessibility_core/accessibility_core.gd:111: medium `spec`. The `## error` row "engine does not support a full-screen shader: applies no filter, warn once per `init`" (`open-game-works-core/skills/client-core/modules/accessibility-core.md:104`) has no test. `get_current_rendering_method` and the warn message appear only in `accessibility_core.gd` (lines 108 and 111). The tests assert `warns()` only as 0, and no test makes the rendering method one outside `_SCREEN_SHADER_METHODS`, so removing the warn or the branch fails no test.

## debt

none

## must fix

none

## unknown

- The changes of the commit range are all in `LocalizationCore` (`_restore_heading_types`, its tests) and `records/`. `_restore_heading_types` runs only from `LocalizationCore._clean_up` and changes only the heading types of the font theme. `AccessibilityCore` and its tests use no theme type variation, the subtitle label is a plain `Label` with no heading style, and its tests do not call `load_fonts`. So the range gives no finding. The subtitle label with a project theme after `load_fonts` and `release` was not run.
- `ogw core test godot AccessibilityCore` in this checkout at 0da153b ended with exit 0 and printed `AccessibilityCore pass` and `AccessibilityCore pass (reused)`, so at least part of the result came from the result cache. It is not a new run of every test. The browser run (`--web`) was not run by this review.
- The first `## out of scope` item was not proven by a run. A mutation of a clone in the scratchpad did not test the clone: `ogw core test` takes as the core checkout only a folder under `worktrees/_core/`, so from the scratchpad it ran on the `open-game-works-core-impl/` main checkout. A control mutation that had to fail (removing `_apply_color_mode()` from `apply_saved_settings`) also passed, which showed this, so the results of those runs are not used as evidence. No folder was made under `worktrees/_core/`, because the harness tool manages that folder. The item rests on reading the code. The clone was deleted. Those runs left the main checkout with no uncommitted change and no commit of generated files.
- Color filter pixels with `rendering/viewport/hdr_2d` on were not checked. The render test does not set it.
- Whether a `play_voice` that shows no subtitle (empty subtitle key, invalid handle) should also hide a subtitle already on screen was not judged a problem. The current code keeps it while its own voice plays, and the spec does not state this case directly.
