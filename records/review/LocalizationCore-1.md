# LocalizationCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/localization_core/localization_core.gd:624 | `_apply_fonts` saves the font item of a heading type the theme already had with `_font_theme.has_font(item, type)` / `get_font(item, type)`. In Godot 4.7.2, `Theme.has_font` is `true` and `get_font` returns `default_font` when the theme has a default font, even if the type has no font item of its own. The theme `_apply_fonts` picks always has a default font: the project theme only when `has_default_font()`, otherwise the engine default theme, which has one. So for a heading type that had no font item, `_saved_heading_fonts[type]` is the old `default_font`, not `null`. `_restore_heading_types` (line 710) then calls `set_font(item, type, saved)`, which adds a font item the theme never had, and the `clear_font` branch at line 725 can never run. Reproduced with `godot --headless` 4.7.2 by running the same calls in a script: engine default theme with `Label/font` = X, `HeadingLabel` (base `Label`) with only `font_color`. Before: a `HeadingLabel` Label draws X. After the save, apply and restore steps of `_apply_fonts` and `_clean_up`: `get_font_list("HeadingLabel")` is `["font"]` and a new `HeadingLabel` Label draws the old default font, not X. This differs from the engine rule (godot.md:366): "gives the ones it had their base type and font item back". `test_release_gives_a_heading_type_the_theme_had_its_base_and_font_back` (tests/test_font_weight.gd:521) covers only a type with its own font item, so it does not catch this | Save the font item only when the type has one of its own, e.g. `_font_theme.get_font_list(type).has(item)` (or `has_theme_item` on the type's own items), else `null`. Add a test where the theme had a heading type without a font item (and a `Label/font` of its own), checking that after `release` the type has no font item and the element draws what it drew before `init` | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the GUT core tests of the module (`ogw core test`). R1-1 was reproduced with a standalone Godot 4.7.2 script that makes the same `Theme` calls as `_apply_fonts` and `_clean_up`, not through `LocalizationCore` itself
- `test_a_system_font_without_a_system_font_in_the_browser_runtime_has_no_axis_and_no_engine_error` runs only on the web platform. I did not check it in a browser runtime
- I did not check whether a loaded font resource that is itself a `FontVariation` (with its own variation settings) keeps them when it becomes the `base_font` of the chain. That chain wrapping existed before this range
