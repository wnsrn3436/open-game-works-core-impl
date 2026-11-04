# review AccessibilityCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/accessibility_core/tests/test_saved_settings.gd:50 | Input item D1. `test_set_values_come_back_after_release_init_and_apply_saved_settings` calls `set_text_scale(1500)` (line 33), then only `AccessibilityCore.release()` (line 44) and `init` (line 45); `LocalizationCore` is not released, and `AccessibilityCore.release` (`client/godot/core/accessibility_core/accessibility_core.gd:117`) does not touch the text scale. So `LocalizationCore.get_text_scale()` is already 1500 at line 50 even when `_apply_text_scale()` is removed from `apply_saved_settings` (`client/godot/core/accessibility_core/accessibility_core.gd:154`). The other text scale asserts after `apply_saved_settings` (lines 17, 72) expect 1000, the value without the call. A saved text scale that stopped reaching `LocalizationCore` at boot would pass every test of the module | Before `apply_saved_settings`, bring `LocalizationCore` back to 1000 (release and init it, or save the value directly in the device file before `init` as line 65 does) and assert `get_text_scale` is 1500 only after `apply_saved_settings` | no | 95 |
| R1-2 | spec | medium | open-game-works-core/skills/client-core/modules/accessibility-core.md:142 | Input item D2. `## DEV` says after `set_test_text_scale` "On `release` it returns to the saved value", while `### release` (line 83) says the value passed to `LocalizationCore` is reverted by the `release` of that module, and `LocalizationCore.release` sets 1000 (`open-game-works-core/skills/client-core/modules/localization-core.md:119`). Run path: `set_text_scale(1250)`, `set_test_text_scale(1500)`, `AccessibilityCore.release()`: by line 83 the text scale is left to `LocalizationCore` (stays 1500, or 1000 after its `release`); by line 142 it is 1250. The spec gives two values for the moment right after `release` | Settle one behavior in the spec: either `AccessibilityCore.release` sets the saved (or applied) text scale back on `LocalizationCore`, or the DEV sentence says the test value stays until `LocalizationCore.release` or the next `apply_saved_settings`; add a `## test` item for it | yes | 90 |
| R1-3 | spec | medium | client/godot/core/accessibility_core/accessibility_core.gd:117 | Input item D4. `release` (lines 117-129) and `_clean_up`/`_reset_state` (lines 496-531) never call `LocalizationCore.set_text_scale`, and `AccessibilityCoreDev.set_test_text_scale` (`client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:17`) keeps no value to return to. Run path: `set_text_scale(1250)`, `AccessibilityCoreDev.set_test_text_scale(1500)`, `AccessibilityCore.release()`, then `LocalizationCore.get_text_scale()` is 1500, not the saved 1250 that `## DEV` (accessibility-core.md:142) states. No test in `client/godot/core/accessibility_core/tests/` calls `release` after `set_test_text_scale` (`test_text_scale.gd` lines 26-66) | Implement the behavior R1-2 settles and add a core test that runs `set_test_text_scale` then `release` and asserts the text scale | no | 90 |
| R1-4 | spec | medium | client/godot/core/accessibility_core/accessibility_core.gd:111 | Input item D3. The `## error` row "engine does not support a full-screen shader: applies no filter, warn once per `init`" (accessibility-core.md:104) has no test. `RenderingServer.get_current_rendering_method` and the warn text appear only in `accessibility_core.gd` lines 108 and 111; the tests assert `warns()` only as 0 (`test_saved_settings.gd` lines 20, 74, 86) and no test makes the rendering method one outside `_SCREEN_SHADER_METHODS`. Removing the branch or the warn fails no test | Make the rendering method check replaceable in tests (e.g. read it through a module-private static that a core test can set) and add a test: unsupported method gives no `_filter`, one warn per `init`, and `set_color_mode` still succeeds | no | 95 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | Code unchanged (empty commit range); `test_saved_settings.gd:44` still releases only `AccessibilityCore`, so line 50 holds without `accessibility_core.gd:154` |
| D2 | open | R1-2 | accessibility-core.md:83 and :142 still give different text scales right after `release` |
| D3 | open | R1-4 | No test reaches `accessibility_core.gd:111`; `warns()` is asserted only as 0 |
| D4 | open | R1-3 | `release` (`accessibility_core.gd:117`) still does not restore the text scale and `accessibility_core_dev.gd:17` keeps no saved value; no test checks it |

## must fix

none

## unknown

- The commit range is empty (`e02d2bf..e02d2bf`), so no change of the range was reviewed; only the input debt items were checked, against the current code
- No core test or mutation was run: the Godot core project needs the files that `ogw core test` generates (`project.godot`, `generated/`, `addons/`), which are not present in this checkout. D1 (`R1-1`), D3 (`R1-4`) and D4 (`R1-3`) were judged by reading the code and tests, not by a failing run
- The pixel results of `test_render_color_filter.gd` (render tests skipped in the headless pass) were not checked
