# QACore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/qa_core/dev/qa_query.gd:403 | `_font_weight` takes the `wght` of the outermost `FontVariation` that sets one (lines 399-404), as `open-game-works-core/skills/client-core/engines/godot.md:406` says. But Godot 4.7.2 draws only the `variation_opentype` of the outermost `FontVariation`: an inner one's coordinates are dropped (the linked variation is made from the base font; `client/godot/core/localization_core/localization_core.gd:638` states the same). Reproduced with headless Godot 4.7.2 and `client/godot/core/qa_core/tests/resources/qa_font_weight_axis.tres`, whose "A" advance is 600 units at weight 400 or below and grows by 400 units from weight 400 to 900. `get_string_size("A", size 100)`: base 60, FontVariation(wght 700) 84, outer(no wght)->inner(wght 700) 60, outer(no wght)->middle(700)->inner(300) 60. A `Label` with font override outer(no wght)->inner(wght 900) has minimum width 60. So the text is drawn at the axis default 400, while `list_ui` reports 700 (`client/godot/core/qa_core/tests/test_font_weight.gd:133` asserts 700 for that chain). This breaks `open-game-works-core/skills/client-core/modules/qa-core.md:137` ("the OpenType `wght` value at which the element draws its text"). Reached in content when the font of a font key is itself a `FontVariation` resource that sets `wght` and the text style weight is 0: `_weighted_chain` wraps it in a `FontVariation` that sets no `wght`. | Change godot.md:406 so the weight is the `wght` of the outermost `FontVariation` only (the axis default when that one sets none), then make `_font_weight` and the test at test_font_weight.gd:133 follow it | yes | 90 |
| R1-2 | test evidence | medium | client/godot/core/qa_core/tests/test_font_weight.gd:137 | Both test fonts declare weight class 400, and the axis default of the axis font is also 400. Headless Godot 4.7.2: `font_get_weight` is 400 for `qa_font_weight_axis.tres` (axes `{wght: (100, 900, 400)}`) and 400 for `qa_font_no_weight_axis.tres` (no axes). So `test_a_font_without_the_axis_gives_its_weight_class` (line 137) still passes when `return TextServerManager.get_primary_interface().font_get_weight(rids[0])` at qa_query.gd:413 is replaced by `return 400`. `test_weights_0_give_the_axis_default` (line 97) and the `Unset` case (line 134) still pass when `axis.z` at qa_query.gd:414 is replaced by `font_get_weight(rids[0])`. The weight class branch and the axis default branch of qa-core.md:137 / spec test qa-core.md:433 are therefore not checked | Use a no-axis test font with a weight class other than 400 and the axis default (e.g. 700), and an axis font whose default differs from its weight class (e.g. default 300) | no | 90 |
| R1-3 | spec | medium | client/godot/core/qa_core/tests/test_frame_interval.gd:227 | `open-game-works-core/skills/client-core/modules/qa-core.md:185-186`: when the automation channel connects, QACore empties the record, and emptying also resets `max_frame_interval_ms`. The code does this through `_empty_frame_intervals` at `_poll_channel` (client/godot/core/qa_core/dev/qa_core.gd:780, 1182-1185), but no test reads `max_frame_interval_ms` after a connection. `test_the_first_get_stats_of_a_connection_holds_only_intervals_after_the_connection` waits 120 ms before the connection, but checks only `frame_intervals_ms`. If the reset moves from `_empty_frame_intervals` into `_take_frame_intervals_json`, the first `get_stats` of a connection reports the 120 ms frame from before it, and every test still passes (the other max tests reset it through `get_stats`) | In that test, also assert that `max_frame_interval_ms` of the first `get_stats` of the connection is under `WAIT_MS` | no | 85 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The QACore core tests (`ogw core test`) were not run. R1-1 and R1-2 were checked with standalone headless Godot 4.7.2 scripts outside the checkout, not through the core test runner
- The browser runtime path of `get_stats` (`_page_memory`, `JavaScriptBridge.eval` of `wasmMemory` and `performance.memory`) was not run. Only the code and `test_a_browser_run_gives_the_webassembly_memory_and_the_page_heap` were read
- The `VmRSS` reading of `resident_memory_bytes` on `android` and `linux` was not run on those platforms (the host is macOS). Only the parsing of the line was checked against the `/proc/self/status` format
- The TimeCore, BootstrapCore and other module changes of the commit range were read only where QACore calls them (`TimeCoreDev.get_frame_step_fps`). They are their own review targets
