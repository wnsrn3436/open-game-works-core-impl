# review AccessibilityCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/accessibility_core/accessibility_core.gd:126 | The changed DEV text (`open-game-works-core/skills/client-core/modules/accessibility-core.md:142`) says the test text scale stays until `LocalizationCore.release`, the next `apply_saved_settings`, the next `set_test_text_scale` or a `set_text_scale` that changes the option value, and "`release` of AccessibilityCore does not set it back"; the new `## test` item (line 158) says that after `set_text_scale`(1250), `set_test_text_scale`(1500) and `release`, `LocalizationCore.get_text_scale` is 1500. `release` still calls `_apply_text_scale()` when `_test_text_scale_applied` (lines 126-127, flag set by `client/godot/core/accessibility_core/dev/accessibility_core_dev.gd:18`), so that run gives 1250. `client/godot/core/accessibility_core/tests/test_text_scale.gd:68` (`test_release_after_set_test_text_scale_puts_the_saved_text_scale_back`) asserts 1250 at line 75, and `ogw core test godot AccessibilityCore --file client/godot/core/accessibility_core/tests/test_text_scale.gd` passes, which confirms the run gives 1250. The comments at `accessibility_core.gd:83` and `dev/accessibility_core_dev.gd:9` also still say `release` goes back to the saved value | Remove lines 126-127 and `_test_text_scale_applied` (declaration, DEV setter line 18, `_reset_state` line 546); change the test at `test_text_scale.gd:68` to assert 1500 after `release` and 1250 after `init` and `apply_saved_settings` (spec line 158); fix the two comments | no | 95 |
| R3-2 | spec | medium | client/godot/core/accessibility_core/tests/test_text_scale.gd:26 | New `## test` item `open-game-works-core/skills/client-core/modules/accessibility-core.md:159` (after `set_text_scale`(1250) and `set_test_text_scale`(1500): `get_settings` 1250; `set_text_scale`(1250) leaves `get_text_scale` 1500 with no `AccessibilityChangedEvent`; `set_text_scale`(1000) makes it 1000 with one event) has no test. `test_text_scale.gd:26` checks only that the option value stays 1000 with no prior `set_text_scale`; `client/godot/core/accessibility_core/tests/test_events.gd:33` counts events over `set_test_text_scale` and `apply_saved_settings` only. No test calls `set_text_scale` after `set_test_text_scale` (grep of `client/godot/core/accessibility_core/tests/` for `set_test_text_scale`). The code (`accessibility_core.gd:185-191`) behaves as the item says, but a change that re-applies on the same value or compares with `LocalizationCore.get_text_scale` would pass every test | Add a test with that run path: assert `get_settings().text_scale_permille` 1250, `get_text_scale` 1500 and event count 0 after `set_text_scale`(1250), then `get_text_scale` 1000 and event count 1 after `set_text_scale`(1000) | no | 90 |
| R3-3 | spec | medium | client/godot/core/accessibility_core/tests/test_subtitles.gd:66 | New part of `## test` item `open-game-works-core/skills/client-core/modules/accessibility-core.md:153`: "a second `play_voice` with an invalid handle or an empty subtitle translation key leaves the previous subtitle visible until its playback ends" (behavior lines 76-77 changed to the subtitle that a new `play_voice` shows). No test makes a second `play_voice` while a subtitle is visible with an invalid handle or an empty key: `test_subtitles.gd:66` uses two valid calls, `test_subtitles.gd:95` (empty key) and `test_subtitles.gd:105` (invalid handle) each start with no subtitle on screen. The code returns before touching `_subtitle_label` and `_subtitle_handle` (`accessibility_core.gd:248-252`), but a change that hides the previous subtitle there (e.g. calling `_hide_subtitle()` before the early returns) would pass every test | Add a test: show a subtitle with `VOICE_LOOP`, call `play_voice` with an empty key and with a released scope (invalid handle), assert the first subtitle text and `_subtitle_handle` stay and it is visible after a frame, then stop the first voice and assert it hides | no | 90 |

## previous

| id | result | evidence |
|---|---|---|
| R1-2 | fixed | The spec text the finding pointed to changed: `open-game-works-core/skills/client-core/modules/accessibility-core.md:142` now says `release` of AccessibilityCore does not set the test text scale back and names when it ends, which agrees with `### release` (line 83, the values passed to `LocalizationCore` are reverted by the `release` of that module), and `## test` line 158 checks it. "Saved value" is no longer used, so the case of `set_test_text_scale` before `apply_saved_settings` is no longer unset. The code still sets the text scale back in `release`; that is the new difference written as R3-1 |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | fixed | none | The two sentences no longer give different values right after `release`: `accessibility-core.md:142` says `release` does not set the test text scale back, the same as line 83, and test item line 158 states the value (1500 after `release`, 1250 after `init` and `apply_saved_settings`). The implementation does not follow the changed text yet: R3-1 |

## must fix

none

## unknown

- The commit range changes no file under `client/godot/core/accessibility_core/`; the changes in other modules were checked only for calls to `AccessibilityCore` / `AccessibilityCoreDev` and for the module specs that the spec diff changed (`localization-core.md`, `ui-core.md`, `camera-core.md`, `godot.md`). The changed `LocalizationCore` UI text element and `bind_text` rules, the `UICore` system popup and panel flow rules and the `CameraCore` follow and zoom rules do not reach what AccessibilityCore calls (`LocalizationCore.set_text_scale`, `get_text`, `format`, `UICore.get_layer`, `CameraCore.set_shake_scale`)
- Only `test_text_scale.gd` was run (`ogw core test godot AccessibilityCore --file ...`, headless pass); the other test files, the render pass and `--web` were not run by this review
- No mutation run was made for R3-2 and R3-3; the claim that no test fails is from reading every test file of `client/godot/core/accessibility_core/tests/`
