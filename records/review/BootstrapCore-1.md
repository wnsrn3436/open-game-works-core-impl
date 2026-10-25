# BootstrapCore review round 1

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

- The range changes BootstrapCore only at client/godot/core/bootstrap_core/bootstrap_core.gd:1125-1126 (fatal screen `Label` gets `add_theme_font_override("font", ThemeDB.fallback_font)`) and adds two tests at client/godot/core/bootstrap_core/tests/test_boot_fatal.gd:183-250. Checked against bootstrap-core.md `### fatal error` (fatal screen "drawn with the engine's default means, without data, translation or game resources"), `LocalizationCore._apply_fonts` (client/godot/core/localization_core/localization_core.gd:613-633, which sets the theme `default_font` and only the `HeadingLabel`/`HeadingButton`/`HeadingRichTextLabel` variations, so a plain `Label` with an own `font` override is not reached), and UICore (sets no `theme` on its layers). No finding
- `ThemeDB.fallback_font` being the engine built-in font depends on `gui/theme/custom_font` staying out of `project.godot`; client-content engines/godot.md allows no `gui/theme/` prefix in `client/boot/project_settings.cfg`. Not checked in the `ogw generate` tool code
- The tests were read, not run; the defect was not restored to see them fail (round 1 has no `test evidence` finding to verify). The core agent report says both fail with the override line removed
- The other changes of the range (client/godot/core/qa_core/, client/godot/core/requirement_core/, records/) are outside the target and were not reviewed
