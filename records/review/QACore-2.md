# review QACore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/qa_core/dev/qa_core.gd:1241` `_apply_module_states` no longer makes the `Array[bool]` literal; it loops `_STATE_COUNT` and calls `_wanted_state` (qa_core.gd:1251), which returns a `bool` from a `match` and makes no collection. The states it returns equal the old literal for each index (constants qa_core.gd:72-77): `_STATE_DEV_MUTE` → `_feedback_off`; `_STATE_PLAY_SKIP`, `_STATE_FINITE_SKIP` → `_reward_window_open`; `_STATE_SHAKE_SKIP`, `_STATE_WORLD_SKIP`, `_STATE_EFFECT_SKIP` (the `_` branch) → `_feedback_off or _reward_window_open`. The frame path `_on_frame_start` → `_check_reward_window` → `_apply_module_states` makes no `Array` literal any more |
| R1-2 | fixed | `client/godot/core/qa_core/tests/test_frame_interval.gd:90` `test_putting_intervals_into_a_full_record_allocates_no_memory` fills the record, calls `LogCore.release`, runs 100 warm-up calls and asserts `Performance.OBJECT_COUNT` and `MEMORY_STATIC` did not grow over 1000 measured `QACore._record_frame_point` calls. Restored defect, in a copy of `client/godot` (with `addons/` and `.godot/` of the main checkout at the same commit 975bd8c4) in the session scratchpad, run headless with GUT `-gselect=test_frame_interval.gd -gunit_test_name=allocates_no_memory` and the UnitTestCore pre- and post-run hooks: unchanged code passes (1/1); (a) `static var _review_leak: Array = []` with `_review_leak.append(point_usec)` at the start of `_record_frame_point` fails with `no memory is allocated`; (b) the same with `_review_leak.append(RefCounted.new())` fails with `no object is made` and `no memory is allocated` |

## out of scope

none

## debt

none

## must fix

none

## unknown

- The mutation runs for R1-2 were native headless runs on macOS only; the browser run (`--web`) of the new memory test was not run in this review (the core agent report says `ogw core test godot QACore BootstrapCore UnitTestCore --web` passed on the fixed code)
- The other tests of QACore and of its dependents were not run in this review; the core agent report says they pass
- The TweenCore test change of the range (`client/godot/core/tween_core/tests/test_finite_skip.gd`) and the review records of other modules in the range are not QACore code and were not reviewed
