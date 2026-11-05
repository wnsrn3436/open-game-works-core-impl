# review AccessibilityCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `release` (`client/godot/core/accessibility_core/accessibility_core.gd:120`) no longer calls `_apply_text_scale()`; `_test_text_scale_applied` is gone from the declarations, `_reset_state` (line 522), the DEV setter (`client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:12`) and `tests/test_lifecycle.gd` (grep of `client/` finds no reference). So after `set_text_scale`(1250), `set_test_text_scale`(1500) and `release`, nothing calls `LocalizationCore.set_text_scale` and the value stays 1500; `init` (lines 88-117) passes no text scale; `apply_saved_settings` (line 158) applies the saved 1250. That is `open-game-works-core/skills/client-core/modules/accessibility-core.md:142` and test item line 158. `client/godot/core/accessibility_core/tests/test_text_scale.gd:68` asserts 1500 after `release`, 1500 after `init`, 1250 after `apply_saved_settings` and a device file of 1250. The comments at `accessibility_core_dev.gd:9-11` now name when the test text scale ends, the same as spec line 142; the `accessibility_core.gd` comment the finding named was removed with the field |
| R3-2 | fixed | `client/godot/core/accessibility_core/tests/test_text_scale.gd:84` runs the path of spec line 159: after `set_text_scale`(1250) and `set_test_text_scale`(1500) it asserts `get_settings().text_scale_permille` 1250, then after `set_text_scale`(1250) `LocalizationCore.get_text_scale` 1500 and `changes` 0 (counter from `count_changes`, `tests/support/accessibility_test_case.gd:141`), then after `set_text_scale`(1000) 1000 and `changes` 1. The two changes the finding named are caught by reading the asserts: re-applying before the same-value return (`accessibility_core.gd:181`) makes `get_text_scale` 1250 at the 1500 assert; comparing with `LocalizationCore.get_text_scale` (1500 ≠ 1250) applies 1250 and publishes, failing the 1500 and the 0-event asserts |
| R3-3 | fixed | `client/godot/core/accessibility_core/tests/test_subtitles.gd:83` shows a `VOICE_LOOP` subtitle, calls `play_voice` with an empty key (plays, one error) and with a released scope (invalid handle, one `SoundCore` error), then asserts the subtitle is visible, has the first text and `_subtitle_handle` is the first handle; after stopping the empty-key voice and 2 frames it is still visible, and after stopping the first voice it hides in 1 frame. That is spec line 153 (second half). Calling `_hide_subtitle()` before the early returns at `accessibility_core.gd:244-248` fails the `subtitle_visible` assert; setting `_subtitle_handle` before them fails the handle assert and the visible-after-stopping-the-empty-key-voice assert |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range changes, under the target, only `accessibility_core.gd`, `dev/accessibility_core_dev.gd` and the tests `test_lifecycle.gd`, `test_subtitles.gd`, `test_text_scale.gd`. The other changes in the range (`server/core/*`, `core-spec/routing.json` key `storage.userLockWaitMs`, `settings/core-settings.schema.json`, `records/`) are not part of AccessibilityCore and were checked only for references to `AccessibilityCore`; the one caller outside the module, `client/godot/core/qa_core/dev/qa_builtins.gd:266` (`AccessibilityCoreDev.set_test_text_scale`), and its test `client/godot/core/qa_core/tests/test_optional_modules.gd:73` do not depend on `release` setting the text scale back
- `ogw core test godot AccessibilityCore` (headless) was run and passes; `--web` and the dependent modules (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run by this review
- No mutation run was made for R3-2 and R3-3 (they are `spec` findings, not `test evidence`); the claims that the named changes fail the new tests come from reading the asserts
