# QACore review round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/qa_core/dev/qa_query.gd:403 | The open R1-1 of round 2, now a difference from a changed definition. Input `## spec changes` changed `open-game-works-core/skills/client-core/engines/godot.md:406` to: the weight is the `wght` of `variation_opentype` of the outermost `FontVariation`, or the axis default when that one sets none, because the engine drops the coordinates of the inner ones. `_font_weight` did not change in the range (no `client/` file is in the range) and still keeps the first `FontVariation` from the outside that sets a `wght` (`if weight == _NO_WEIGHT: weight = _variation_weight(variation, tag)` at qa_query.gd:403-404 inside the loop over nested variations), and its doc comment at qa_query.gd:390 still says "the outermost `FontVariation` that sets one". Run path: the `Nested` chain of `client/godot/core/qa_core/tests/test_font_weight.gd:119-138` (outer sets no `wght`, middle 700, inner 300, base font with a `wght` axis, default 400). The outer sets none, so the loop takes 700 from the middle and `list_ui` reports `font_weight` 700, which `test_font_weight.gd:138` asserts and which passed on unchanged code in round 2. The changed rule gives the axis default 400, the weight round 1 reproduced as drawn | Read `variation_opentype` only of the outermost `FontVariation` (the theme font itself when it is one) and give the axis default when it sets no `wght` or the theme font is no `FontVariation`; still follow nested `base_font`s only to find the first font. Change `test_font_weight.gd:138` to assert the axis default for `Nested` and add a case where only the outermost sets `wght` under an inner one that sets another value, so that the test fails on the current loop. Update the doc comments at qa_query.gd:388-390 and test_font_weight.gd:3 | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | The code and test it names are unchanged in the range (qa_query.gd:403-404, test_font_weight.gd:138). The definition was changed in the direction of the round 1 reproduction (`open-game-works-core/skills/client-core/engines/godot.md:406` now names only the outermost `FontVariation`), so the remaining fix is in code; it is written again as R3-1 with spec change `no` |

## out of scope

- client/godot/core/localization_core/localization_core.gd:642: medium The changed `open-game-works-core/skills/client-core/modules/localization-core.md:106` says a weight of 0 draws the font at the weight the font of the font key is drawn with by itself, e.g. the `wght` of a `FontVariation`, and the new test item at localization-core.md:260 says a first font that sets its own `wght` 700 is drawn at 700 with weight 0. `_weighted_chain` always wraps `fonts[0]` in a new outer `FontVariation` (`chain.base_font = fonts[0]`) and sets no `wght` on it when `_takes_weight` is `false` for weight 0 (localization_core.gd:658-661). By the changed godot.md:406 the engine draws only the outermost `variation_opentype`, so such a font is drawn at its axis default, not 700. LocalizationCore code, not QACore code

## debt

none

## must fix

none

## unknown

- No test was run in this round. The range changes no file under `client/`, so the QACore code and tests are the same as in round 2, whose run of `ogw core test godot QACore --file test_font_weight.gd` on unchanged code passed, including the 700 assertion at test_font_weight.gd:138. R3-1 is judged from that run, the code and the round 1 reproduction of the drawn weight
- The LocalizationCore item in `## out of scope` was found by reading `_weighted_chain` against the changed localization-core.md and godot.md lines; it was not run, and the LocalizationCore tests were not read for whether they hold the new item at localization-core.md:260
- The change at `open-game-works-core/skills/client-core/engines/godot.md:121` (launch values in the browser runtime only for a DEV export) is about `core/web/ogw-shell.html` and the harness tool. QACore takes launch values only through `BootstrapCoreDev.get_launch_value` (`client/godot/core/qa_core/dev/qa_core.gd:766`), so it does not reach QACore code. The shell was not reviewed
- The server, records and review-debt changes of the range are not QACore code and were not reviewed
