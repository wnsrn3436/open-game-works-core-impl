# QACore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | open | Not changed in the range: `client/godot/core/qa_core/dev/qa_query.gd:399-405` still takes the `wght` of the outermost `FontVariation` that sets one (`weight = _variation_weight(variation, tag)` at qa_query.gd:404 only while `weight == _NO_WEIGHT`), and `client/godot/core/qa_core/tests/test_font_weight.gd:138` still asserts 700 for the `Nested` chain (outer sets no `wght`, middle 700). `open-game-works-core/skills/client-core/engines/godot.md:406` still says "the outermost `FontVariation` that sets it", and input `## spec changes` is `none`. The core agent report did not dispute the finding and left it as a spec proposal (spec change `yes`). The drawn weight of that chain is still the axis default 400, by the round 1 reproduction, so `font_weight` still differs from `open-game-works-core/skills/client-core/modules/qa-core.md:137` |
| R1-2 | fixed | `client/godot/core/qa_core/tests/resources/qa_font_weight_axis.tres` now has weight class 600 (axis default 400), and `qa_font_no_weight_axis.tres` weight class 700. `test_font_weight.gd:106` asserts the axis font's weight class is 600, and `test_font_weight.gd:147-150` assert 700 for the font without the axis. Restored the defects in temporary `git worktree add --detach` worktrees of e482643d in the session scratchpad and ran `ogw core test godot QACore --file test_font_weight.gd`. Unchanged code: pass. (a) `return 400` in place of `return TextServerManager.get_primary_interface().font_get_weight(rids[0])` at qa_query.gd:413: fail, `test_a_font_without_the_axis_gives_its_weight_class` [400] expected to equal [700]. (b) `else TextServerManager.get_primary_interface().font_get_weight(rids[0])` in place of `else axis.z` at qa_query.gd:414: fail, `test_weights_0_give_the_axis_default` [600] expected to equal [400], and `test_the_outermost_font_variation_that_sets_a_weight_gives_it` [600] expected to equal [400] ("no FontVariation sets wght") |
| R1-3 | fixed | `client/godot/core/qa_core/tests/test_frame_interval.gd:219` asserts that the longest interval before the connection holds the 120 ms wait, and `test_frame_interval.gd:229` asserts that `max_frame_interval_ms` of the first `get_stats` of the connection is under `WAIT_MS`. Restored the defect in a temporary worktree of e482643d: deleted `_frame_interval_max_usec = 0` from `_empty_frame_intervals` (`client/godot/core/qa_core/dev/qa_core.gd:1185`) and added it after `_empty_frame_intervals()` in `_take_frame_intervals_json`. `ogw core test godot QACore --file test_frame_interval.gd`: fail, `test_the_first_get_stats_of_a_connection_holds_only_intervals_after_the_connection` "the connection reset max_frame_interval_ms", with `max_frame_interval_ms` 120.29. Unchanged code: pass |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The mutation runs were native headless runs on macOS only (`ogw core test godot QACore --file ...`). The browser run (`--web`) and the other QACore test files were not run in this review. The core agent report says `ogw core test godot QACore BootstrapCore UnitTestCore` passed, with and without `--web`
- R1-1 was not reproduced again in this round. Its result is `open` because the code, the test and godot.md:406 did not change in the range
- The weight class change of the two test fonts was checked only through the font weight tests above. A grep finds no other user of `qa_font_*` under `client/godot`. The LocalizationCore copies of these fonts were not changed in the range
- The BootstrapCore, InputCore, server and records changes of the commit range are not QACore code and were not reviewed
