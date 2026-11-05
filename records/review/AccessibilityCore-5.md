# review AccessibilityCore round 5

## findings

none

## previous

none (the round 4 review `records/review/AccessibilityCore-4.md` has no findings and no `open` rows)

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range `7ce279d..92e208b` changes no file under `client/godot/core/accessibility_core/`, and no file of its callers outside the module (`client/godot/core/bootstrap_core/bootstrap_core.gd`, `client/godot/core/qa_core/dev/qa_builtins.gd`, their tests, `client/godot/core/unit_test_core/tests/resources/sample_settings.gd`). The client changes of the range in its dependencies were read for the paths AccessibilityCore uses: `client/godot/core/localization_core/localization_core.gd` (`bind_text`/`unbind_text` checks, timezone test offset; `set_text_scale`, `get_text`, `format` used by `accessibility_core.gd:250-252,372` unchanged), `client/godot/core/camera_core/camera_core.gd` (3D zoom at factor 1, `attach_camera` comments; `set_shake_scale` used by `accessibility_core.gd:397` unchanged), `client/godot/core/ui_core/ui_core.gd` (loading system popups; `get_layer` of `MESSAGE` and `LOADING_ICON` used by `accessibility_core.gd:95-96` unchanged). No change reaches AccessibilityCore behavior. The server, tool, settings schema and other client module changes of the range were checked only for references to `AccessibilityCore` (none besides `records/` and the round 4 review)
- Spec changes: the one hunk in `accessibility-core.md` (line 142) removes the sentence "`release` of AccessibilityCore does not set it back"; the remaining text ("stays until `LocalizationCore.release`, the next `apply_saved_settings`, the next `set_test_text_scale` or a `set_text_scale` that changes the option value") and test item line 158 still give the same behavior, which `accessibility_core.gd:120-133` (no `LocalizationCore.set_text_scale` call), `dev/accessibility_core_dev.gd:9-11` and `tests/test_text_scale.gd:68` match. The `localization-core.md` hunks drop the destroyed-element rows of `bind_text`/`unbind_text`; AccessibilityCore calls neither (it writes `_subtitle_label.text` directly). The `camera-core.md`, `ui-core.md`, `godot.md`, `core/SKILL.md` and `core/command.md` hunks change nothing that AccessibilityCore calls or relies on (`CameraCore.set_shake_scale`, `ScreenEffectCore.set_flash_opacity_limit`, `UICore.get_layer`, `SafeAreaCore.get_safe_area`/`get_inset` and `SoundCore.play`/`is_playing` were not changed by the diff)
- `ogw core test godot AccessibilityCore` was run (job `mw3l993k74883e`) and reported `AccessibilityCore skipped` with "render pass not run: the macOS screen is locked or the display sleeps"; this review therefore has no test run result for this range. `--web` and the dependent modules (`BootstrapCore`, `QACore`, `UnitTestCore`) were not run
