# review MessageCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/message_core/tests/test_text.gd:33 asserts `show_toast(key_a(), null, "code 42")` again, next to the `FormatArgs` assertion at client/godot/core/message_core/tests/test_text.gd:36, with `close_all` between them. Defect restored in temporary copies of client/godot and fixtures outside the checkout, with GUT started directly on the 51 MessageCore tests and a local test host answering 204. Each restored copy ends with exit code 1, 50 of 51 pass, and the one failure is `test_extra_text_follows_the_text_after_one_line_break`. Restore 1: client/godot/core/message_core/message_core.gd:183 changed to `text += ("\n" if args != null else " ") + extra_text`, which fails with got `Ui exit confirm code 42`, message `without FormatArgs`. Restore 2: client/godot/core/message_core/message_core.gd:182 changed to `if extra_text != "" and args != null:`, which fails with got `Ui exit confirm`, message `without FormatArgs`. The unchanged copy passes 51 of 51 with exit code 0 in 3 of 3 runs, run at the same time as the restored copies. Also checked: `if extra_text != "" and args == null:` at the same line fails with got `3 items for you`, message `with FormatArgs`, so both requests are asserted |

## out of scope

none

## debt

none

## must fix

none

## unknown

- `ogw core test godot MessageCore` on the range head printed `pass` and `pass (reused)` on the native run, so at least one pass came from a reused result and was not a new run. The direct GUT runs in `## previous` are the fresh native evidence. `ogw core test godot MessageCore --web` printed `pass` twice
- The restored copies were run by starting GUT directly, not through `ogw core test`, so its static check and result judgement did not run on them
- Round 1 `## unknown` listed exit code 1 although GUT reported all tests passed. In this round the same result came from a local test host that answered 200, and it became exit code 0 when the host answered 204: client/godot/core/unit_test_core/dev/unit_test_core.gd:938 treats any other status as not sent, and the exit code is then 1 at client/godot/core/unit_test_core/dev/unit_test_core.gd:283. That matches the direct run of round 1 only if its run also had no such host; how round 1 ran was not checked
- Round 1 `## unknown` listed one `UICore.prepare` failure in `test_close_black_box_empties_black_boxes_and_toast_goes_on`. It did not appear in the 6 full runs of this round (3 unchanged, 3 restored), all run at the same time. Its cause was not checked
- The items of records/review-debt/spec-MessageCore.json were not judged. They are spec review items and input `## debt` is `none`
- `## spec changes` is `none`, and the range changed only client/godot/core/message_core/tests/test_text.gd under MessageCore, so the implementation was read only at the code that test reaches. Other changes in the range (coupon, data-tool, records) belong to other targets and were not reviewed
- Rendering of the toast and black box in a real window was not checked beyond the existing tests
