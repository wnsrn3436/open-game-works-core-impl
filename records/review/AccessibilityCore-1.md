# review: AccessibilityCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The commit range `772306a..ea339cf` changes only `LocalizationCore` (font weight, heading text style), its tests, core settings and generated settings. No file of `client/godot/core/accessibility_core/` changed. Checked how the changes reach AccessibilityCore: the subtitle text element (`client/godot/core/accessibility_core/accessibility_core.gd:403`) is a plain `Label` with no `theme_type_variation`, so it is in the `body` text style and takes the default font (`LocalizationCore.bodyFontWeight`), as `open-game-works-core/skills/client-core/modules/localization-core.md:108` sets for an element whose text style was not set. `_layout_subtitle` (`client/godot/core/accessibility_core/accessibility_core.gd:451`) measures the wrapped text height every frame while a subtitle is visible, so a change of glyph width from the weight is laid out again. `client/godot/core/ui_core/` and `client/godot/core/safe_area_core/` set no theme or font of their own, so the theme `LocalizationCore` writes reaches the subtitle box. The AccessibilityCore tests do not call `LocalizationCore.load_fonts`, and both weight settings default to 0, so the new required settings keys do not change their start (`client/godot/generated/core_settings.json` has both keys)
- Tests were not run by this review. The core agent report `records/1792899335100-update-core-mvn9z0scb9678f.md` states that the headless and web passes of the AccessibilityCore tests passed and that the render pass (`client/godot/core/accessibility_core/tests/test_render_color_filter.gd`) was skipped because the macOS screen was locked; that render pass is not checked against this range
- Not checked: subtitle drawing with a heavier body weight in a real font chain with a `wght` axis, because no AccessibilityCore test or this review loads a weighted font chain
