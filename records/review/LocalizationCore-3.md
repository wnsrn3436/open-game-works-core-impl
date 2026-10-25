# LocalizationCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | fixed | `test_release_gives_a_heading_type_the_theme_had_its_font_item_without_a_font_back` (client/godot/core/localization_core/tests/test_font_weight.gd:258-262) now sets `theme.default_font` to another `FontVariation` after `release`. It asserts that `get_font(&"font", &"HeadingButton")` and the button's `get_theme_font("font")` both give that font, then puts `before` back. Defect restored in a temporary worktree of 369bbe8 under `worktrees/_core/` (outside this checkout): client/godot/core/localization_core/localization_core.gd:627 changed to `_saved_heading_fonts[type] = own`. `ogw core test godot LocalizationCore --file client/godot/core/localization_core/tests/test_font_weight.gd` failed that test with `FontFile ... expected to equal FontVariation` on the new asserts, and no other test in the file failed. The same command on unchanged 369bbe8 (the `open-game-works-core-impl/` main checkout) passed |

## out of scope

none

## debt

none

## must fix

none

## unknown

- I ran only `test_font_weight.gd` through `ogw core test --file` (native headless), not the full module run or the browser run (`--web`). The range changes only that test file
- From round 2, still unchecked and unchanged by this range: whether a loaded font resource that is itself a `FontVariation` keeps its own variation settings when it becomes the `base_font` of the chain. Also, `test_a_system_font_without_a_system_font_in_the_browser_runtime_has_no_axis_and_no_engine_error` is still not checked in a browser runtime
