# BootstrapCore review round 2

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | client/godot/core/bootstrap_core/bootstrap_core.gd:1125-1126 gives the fatal screen `Label` `add_theme_font_override("font", ThemeDB.fallback_font)` (commit 97e51c7). An own theme override comes before any theme lookup, so the label no longer reads the theme `default_font` that `LocalizationCore._apply_fonts` sets to the weighted chain (client/godot/core/localization_core/localization_core.gd:628-629). `bodyFontWeight` lives only on that chain (`_weighted_chain`, localization_core.gd:639-650), so it no longer reaches the label either. The heading variations that `_apply_fonts` sets (localization_core.gd:631-633) do not reach a plain `Label` without `theme_type_variation`. Both run paths of the item are covered: before UI ready after `load_fonts` (client/godot/core/bootstrap_core/tests/test_boot_fatal.gd:185-200) and the fatal popup not opening after UI ready (test_boot_fatal.gd:208-229). Both tests assert, through `_assert_fatal_screen_font` (test_boot_fatal.gd:232-250), that the theme default font is the chain and the label font is `ThemeDB.fallback_font` |

## must fix

none

## unknown

- The commit range is empty (6c62379..6c62379), and there are no core agent reports. Round 1 had no findings, so step 5 has no rows. The review covered only the input `## debt` item D1
- I read the tests for D1 but did not run them. D1 is a debt item, not a `test evidence` finding, so the defect was not restored to see them fail
- `ThemeDB.fallback_font` is the engine built-in font only when `gui/theme/custom_font` is not set in `project.godot`. This was not checked in the `ogw generate` tool code (same as round 1)
- The fatal screen label still gets the text-scale font size override from `LocalizationCore._on_node_added` (localization_core.gd:761-770), because it is a text element added to the tree. Font size is not data, translation or a game resource, so this is not part of D1. Whether the spec allows it was not judged
