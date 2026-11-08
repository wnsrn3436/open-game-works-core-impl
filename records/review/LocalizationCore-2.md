# review: LocalizationCore round 2

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

- The range e0d97f06c8ed246f01e4cc22f511f81dc899916a..0f7f504508be5618fc9b8685d0b99c9faeb98b27 changes LocalizationCore only in commit fae5e67c: `_weighted_chain` builds the chain and each weighted fallback with `_variation_of` (client/godot/core/localization_core/localization_core.gd:646-691), which copies the variation coordinates, face index, embolden, transform, OpenType features, spacings and baseline offset of a `FontVariation` font, and `_set_weight` now keeps the other coordinates and drops a `wght` key given as a tag or as an axis name (localization_core.gd:701-720). Checked against `skills/client-core/modules/localization-core.md:106-107` (weight 0 draws the font at the weight it is drawn with by itself), the test items at localization-core.md:259-262, and the `font_weight` row of `skills/client-core/engines/godot.md` (the engine draws only the `variation_opentype` of the outermost `FontVariation`): with weight 0 the chain carries the own `wght` 700, with weight 800 it carries 800, and a fallback at weight 0 is appended unchanged and drawn as itself. QACore `_font_weight` (client/godot/core/qa_core/dev/qa_query.gd:396) now reads the outermost `FontVariation`, which is the chain, so it reports the same weight LocalizationCore sets
- New tests at client/godot/core/localization_core/tests/test_font_weight.gd:151-198 check the drawn widths: without the copy of `variation_opentype` the body width of `A` would be the axis default 60 px, not 84 px, and without the copy of the spacings `BB` would be 7 px narrower, so these tests fail on the defects they cover. The copies of face index, embolden, transform, OpenType features and baseline offset, and the branch of `_axis_tag` for an axis name key, have no test; the defining documents set no behavior for them beyond the drawn weight, so no finding was written
- `ogw core test godot LocalizationCore` (job mw7ywckgd92471) passed for the native run and the browser run on this checkout
- Input `## debt` is `none`, so no `## debt` row was written. `records/review-debt/LocalizationCore.json` of this checkout holds D1 (found by QACore round 3) at localization_core.gd:642, the chain that dropped the own `wght` of a first `FontVariation` font at weight 0; commit fae5e67c changes that code as described above and the test at test_font_weight.gd:151 covers that case
- Other changes of the range that reach LocalizationCore: `input_core.gd` only adds an upper bound to `InputCore.padAxisSensitivities` and publishes no new input prompt event; the BootstrapCore changes do not touch its `LocalizationCore` calls. No finding was written for LocalizationCore code that the range does not change
