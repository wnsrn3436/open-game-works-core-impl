# QACore review fix round 1

## done

- QACore (Godot): the core tests of R1-2 and R1-3 fixed (commit a0e5dfae). No change to the QACore implementation.
- `client/godot/core/qa_core/tests/resources/qa_font_weight_axis.tres`: weight class 600 (style name `SemiBold`, OS/2 `usWeightClass` 600); the `wght` axis (100-900, default 400) and the glyph advances are unchanged (checked with headless Godot 4.7.2: `get_string_size("A", 100)` is 60 at the base and 84 at `wght` 700, as before).
- `client/godot/core/qa_core/tests/resources/qa_font_no_weight_axis.tres`: weight class 700 (style name `Bold`, OS/2 `usWeightClass` 700), still no variation axis.
- Godot 4.7.2 takes `font_get_weight` from the style name of the font, not from OS/2 `usWeightClass`: with only `usWeightClass` changed to 600/700, `font_get_weight` stayed 400 for both fonts; once the name table subfamily (name IDs 2, 4 and 6) was changed, it gave 600 and 700. The LocalizationCore copies of these fonts (`client/godot/core/localization_core/tests/resources/font_*weight_axis.tres`) were not changed.
- No engine-specific implementation rules document was written, and `## <engine> build` of `tools/ogw.md` was not written.
- Last `ogw core test`, after the commit: `godot QACore BootstrapCore UnitTestCore` pass, and with `--web` pass. `ogw code check core`: type check, lint, dependency and secret pass.

## spec proposals

- R1-1 (spec change: yes, not fixed): change `open-game-works-core/skills/client-core/engines/godot.md:406` so the weight is the `wght` of the outermost `FontVariation` only, and the axis default when that one sets none, since Godot 4.7.2 draws only the `variation_opentype` of the outermost `FontVariation`. Then `_font_weight` (`client/godot/core/qa_core/dev/qa_query.gd:399-404`) and `test_the_outermost_font_variation_that_sets_a_weight_gives_it` (`client/godot/core/qa_core/tests/test_font_weight.gd`, the `Nested` assertion of 700) follow it.

## review

- R1-1: not fixed, its `spec change` is `yes`. Proposed in `## spec proposals`.
- R1-2: fixed. `client/godot/core/qa_core/tests/resources/qa_font_weight_axis.tres` (weight class 600, axis default 400) and `qa_font_no_weight_axis.tres` (weight class 700). `client/godot/core/qa_core/tests/test_font_weight.gd:106` asserts the weight class 600 of the axis font, so that `test_weights_0_give_the_axis_default` tells it from the axis default 400; `test_font_weight.gd:147-150` assert weight class 700 in `test_a_font_without_the_axis_gives_its_weight_class`. Checked by mutation with `ogw core test`: `return 400` in place of `font_get_weight(rids[0])` at qa_query.gd:413 fails `test_a_font_without_the_axis_gives_its_weight_class` (400 vs 700); `font_get_weight(rids[0])` in place of `axis.z` at qa_query.gd:414 fails `test_weights_0_give_the_axis_default` and the `Unset` case of `test_the_outermost_font_variation_that_sets_a_weight_gives_it` (600 vs 400). Both mutations were reverted.
- R1-3: fixed. `client/godot/core/qa_core/tests/test_frame_interval.gd:219` asserts the longest interval before the connection holds the 120 ms wait, and `test_frame_interval.gd:229` asserts `max_frame_interval_ms` of the first `get_stats` of the connection is under `WAIT_MS`. Checked by mutation: moving the reset of `_frame_interval_max_usec` from `_empty_frame_intervals` into `_take_frame_intervals_json` (qa_core.gd) fails that test; the mutation was reverted.

## unverified

- The font tests were run only on the host (macOS headless and `--web` through `ogw core test`); other platforms were not run.
