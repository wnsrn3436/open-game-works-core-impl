# review: LocalizationCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/localization_core/tests/test_font_weight.gd:229 | `assert_eq(label.get_theme_font_size("font_size"), 76)` in the new test does not read the font size of the style in the theme. `label` is in the tree before the first `init`, so `_track_tree` and `_on_node_added` (client/godot/core/localization_core/localization_core.gd:768) give it an override of 76, `_clean_up` sets that override again on `release` (localization_core.gd:849), and the second `init` reads the override. The update core report says the test "holds a font size the style declares". Run in a temporary copy: after the first `release`, added `theme.clear_font_size(&"font_size", &"ScoreLabel")`, an assert that `get_font_size_list(&"ScoreLabel")` is empty and an assert that `label.has_theme_font_size_override("font_size")`. All 10 tests of the file that are not pending still pass, including line 229, with no font size left on the style in the theme. | Assert a value that comes from the theme: `theme.get_font_size(&"font_size", &"ScoreLabel")`, or `get_theme_font_size` of a new `_label(&"ScoreLabel")` made after the second `init`, which has no override from the first one. Check that it fails when the size is removed from the theme. | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- Run in this review: `ogw core test godot LocalizationCore` and `ogw core test godot LocalizationCore --web` pass on the target commit. The modules of `ogw core dependents LocalizationCore` were not run here; the report of the core agent says they pass.
- Restoring the removed `Theme.remove_type` branch in a temporary copy makes the new test fail at lines 218, 227 and 228 of `test_font_weight.gd`, so the test does catch the defect of this change. This was run natively, not in the browser run.
- A project theme loaded from a `.tres`, which the report lists as unverified, was run in a temporary copy with a throwaway test and no finding came of it. The theme had `default_font`, styles based on the three heading types, and a style based on another style, and did not declare the heading types. Three cycles of `load_fonts`, `release` and `init` kept every base and drew the heading font after each `load_fonts`, and the default font of the theme after each `release`. That test is not in the target and this path has no core test in the core project.
- A project theme without `default_font`, whose styles are based on heading types that `load_fonts` adds to the engine default theme, was not run. The theme choice in `_apply_fonts` is not in the commit range.
- `pong` was not run with this change. Its theme declares the heading types and takes the saved-type path.
