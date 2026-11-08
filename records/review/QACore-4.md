# QACore review round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_font_weight` now reads `variation_opentype` once, from the outermost `FontVariation` only (client/godot/core/qa_core/dev/qa_query.gd:399-400), and the loop at qa_query.gd:401-405 only follows `base_font` to find the first font. This matches `open-game-works-core/skills/client-core/engines/godot.md:406`: the axis default when the outermost sets no `wght` or the theme font is no `FontVariation`. The doc comment at qa_query.gd:388-392 says the same. `test_only_the_outermost_font_variation_gives_the_weight` (client/godot/core/qa_core/tests/test_font_weight.gd:119-148) asserts the axis default for `Nested` (outer none, middle 700, inner 300) and 800 for `Outermost` (outer 800 over inner 300). `ogw core test godot QACore --file test_font_weight.gd` passes on the range end. Restored the old loop by writing qa_query.gd from 1310ede5 into a detached `git worktree add` of HEAD and ran the same command there: it fails with `test_only_the_outermost_font_variation_gives_the_weight: [700] expected to equal [400]` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The `Outermost` assertion (800) passes on both the old and the new loop. The `Nested` assertion is the one that tells them apart. The test reads the weight that `list_ui` reports and does not check the drawn glyphs. That the engine draws only the outermost `FontVariation` comes from godot.md:406 and the round 1 reproduction, and was not reproduced again
- Only the headless run of the test file was done. The `--web` run and the other QACore test files were not run, because no other QACore file changed in the range
- The LocalizationCore problem that round 3 put in `## out of scope` is now D1 of records/review-debt/LocalizationCore.json. It was not checked again, and it is not written here again
- The server, records, settings and generated-settings changes of the range (item-ledger, logging, storage, routing, cheat, admin-api, review records) are not QACore code and were not reviewed
