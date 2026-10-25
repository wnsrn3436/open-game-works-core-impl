# LocalizationCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | test evidence | medium | client/godot/core/localization_core/tests/test_font_weight.gd:240 | `test_release_gives_a_heading_type_the_theme_had_its_font_item_without_a_font_back` is the only test of the new `null if own == _saved_default_font else own` branch (client/godot/core/localization_core/localization_core.gd:627). Its asserts check only that after `release` the type has a `font` item, `get_font` is `before`, and the button draws `before`. When that line is changed to `_saved_heading_fonts[type] = own`, `own` is `before` (since `get_font` gives `default_font` for an item that holds no font), `release` does `set_font(&"font", &"HeadingButton", before)`, and every assert still passes. But the theme now holds a font item set to the old default font object, not an item that holds no font. I reproduced this with `godot --headless` 4.7.2 in a standalone script that makes the same `Theme` calls as the test, `_apply_fonts` and `_clean_up`. With the current line and with the changed line, the test's asserts pass both times. After a later `theme.default_font = other`, `get_font(&"font", &"HeadingButton")` is `other` with the current line and stays `before` with the changed line. So the test name says "its font item without a font back", but the test does not check that | After `release`, also set `theme.default_font` to another font and assert that `get_font(&"font", &"HeadingButton")` (and the button) now gives that font. Then put `before` back. That assert fails when the saved item is the old default font object instead of `null` | no | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_apply_fonts` (client/godot/core/localization_core/localization_core.gd:624) now saves a heading font item only when `_has_own_font` (`get_font_list(type).has(item)`, :732) is true, so `has_font` being true only because of the theme's default font no longer saves one. `_restore_heading_types` (:724) sets the saved item back only for a type that had one. Otherwise it calls `clear_font` on the item `load_fonts` added, so a type that had no font item ends with none. `test_release_leaves_a_heading_type_the_theme_had_without_a_font_item_without_one` (tests/test_font_weight.gd:214) builds the R1-1 reproduction: `Label/font` = X, `HeadingLabel` with only `font_color`. It asserts that after `release` `HeadingLabel` has no `font` item and that existing and new `HeadingLabel` Labels draw X. With the round-1 code, `get_font_list("HeadingLabel")` held `font` and the Label drew the old default font (the round-1 Godot 4.7.2 reproduction), so both asserts fail on it |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I did not run the GUT core tests of the module (`ogw core test`). R2-1 and the R1-1 result were checked by reading the code and with standalone Godot 4.7.2 scripts that make the same `Theme` calls as the tests, `_apply_fonts` and `_clean_up`, not through `LocalizationCore` itself
- I did not check whether a loaded font resource that is itself a `FontVariation` (with its own variation settings) keeps them when it becomes the `base_font` of the chain. That chain wrapping existed before this range and the range did not change it
- `test_a_system_font_without_a_system_font_in_the_browser_runtime_has_no_axis_and_no_engine_error` runs only on the web platform. I did not check it in a browser runtime
