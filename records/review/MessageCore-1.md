# review MessageCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | `test evidence` | medium | client/godot/core/message_core/tests/test_text.gd:27 | The range rewrote `test_extra_text_follows_the_text_after_one_line_break` when `show_black_box` lost its extra text. The old test asserted `show_toast(key_a(), null, "code 42")`, a request without `FormatArgs`. The new test asserts only `show_toast(count_key(), args, "code 42")`, a request with `FormatArgs`. The `## test` item of the spec says that when there is extra text it is the wording, one line break and the extra text joined, and the only non-test caller of extra text passes no `FormatArgs` (client/godot/core/network_core/network_core.gd:1038). Run: in a temporary copy, change client/godot/core/message_core/message_core.gd:183 to `text += ("\n" if args != null else " ") + extra_text`. All 51 MessageCore tests pass (2 of 2 runs) and all 19 tests of network_core/tests/test_failure_flow.gd pass, because `test_diagnostic_text_by_build` checks only `contains`. Adding the old assertion back to that copy fails with `Ui exit confirm code 42` against the text with a line break. A second mutant, `if extra_text != "" and args != null:` at client/godot/core/message_core/message_core.gd:182, also passes all 51 MessageCore tests and is caught only by `test_diagnostic_text_by_build` of NetworkCore | In the same test, keep the `show_toast(key_a(), null, "code 42")` assertion next to the `FormatArgs` one, closing the toast or waiting for it to end between the two so that both wordings are shown | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- `ogw core test godot MessageCore` passed on the range head, on the native run only. The browser run (`--web`) was not run
- The mutants were run by starting GUT directly on a temporary copy of client/godot with the pre-run and post-run scripts, not through `ogw core test`. The exit code was read for one of those runs, and it was 1 although GUT reported all tests passed. The cause was not checked, so the results above are read from the GUT totals
- In one direct run of the second mutant, the first test `test_close_black_box_empties_black_boxes_and_toast_goes_on` failed because `UICore.prepare` failed and the test time limit passed. That test passes no extra text, and it passed in the 2 reruns of the same mutant. The cause was not checked
- The items of records/review-debt/spec-MessageCore.json were not judged. They are spec review items and input `## debt` is `none`
- Rendering of the toast and black box in a real window was not checked beyond the existing tests
