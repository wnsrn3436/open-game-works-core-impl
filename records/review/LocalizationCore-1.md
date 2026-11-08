# review: LocalizationCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | `_weighted_chain` now builds the chain and each weighted fallback with `_variation_of` (client/godot/core/localization_core/localization_core.gd:654-665). For a font that is a `FontVariation`, `_variation_of` copies `variation_opentype`, face index, embolden, transform, OpenType features, spacings and baseline offset into the outer `FontVariation` (localization_core.gd:670-685). With weight 0, `_takes_weight` is `false` and `_set_weight` is not called, so the outermost `variation_opentype` keeps the font's own `wght`. With weight greater than 0, `_set_weight` replaces only the `wght` coordinate and keeps the other axes (localization_core.gd:704-712). This is what localization-core.md:106 sets and what godot.md:406 says the engine draws. The test `test_body_0_draws_a_first_font_that_sets_its_own_wght_700_at_700_without_a_warn` (client/godot/core/localization_core/tests/test_font_weight.gd) loads `font_weight_axis_700.tres`, a `FontVariation` with `wght` 700. It asserts outer `wght` 700 and an advance of 84 (the axis default draws 60), and no warn log, which is the localization-core.md:260 item. In a `git worktree add` copy of HEAD, the defect was restored by making `_variation_of` return the bare wrapper (`if own == null or true: return variation`). `ogw core test godot LocalizationCore` (job mw86ni4g04090d) then failed: that test gave `[-1] expected to equal [700]` and `[60.0] expected to equal [84.0]`, and `test_the_chain_keeps_the_own_variation_of_a_first_font_without_the_axis_and_of_a_fallback_at_weight_0` gave `[120.0] expected to equal [127.0]`. On this checkout, without the change, the same command (job mw86nadr266bc9) passed for both runs. The fix is commit fae5e67c, an ancestor of HEAD |

## must fix

none

## unknown

- The commit range 625ae1894a26f0f1036a2b6817bd40a0c223e5bd..625ae1894a26f0f1036a2b6817bd40a0c223e5bd is empty and input `## spec changes` is `none`, so there is no changed code to review. The review covered only the input `## debt` item D1. It read the font chain code it reaches (`_apply_fonts`, `_weighted_chain`, `_variation_of`, `_takes_weight`, `_set_weight`, `_weight_axis` in client/godot/core/localization_core/localization_core.gd), `tests/test_font_weight.gd` and the test font resource `font_weight_axis_700.tres`. The rest of LocalizationCore was not reviewed, so no finding or out-of-scope problem is written for it
- `ogw core test godot LocalizationCore` (job mw86nadr266bc9) wrote no test record, because the checkout had an uncommitted change (the removed earlier review file at this output path). Its output gave `LocalizationCore pass` for both runs
