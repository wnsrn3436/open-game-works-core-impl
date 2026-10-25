# TweenCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `test_skipping_to_the_end_before_a_later_step_starts_changes_the_offset_of_an_arranged_element` (client/godot/core/tween_core/tests/test_arranged.gd:131) skips during step 1 (`Opacity`) and asserts the step 2 `Position` change lands on `offset_transform_position`, `position` stays the parent's place, and both stay after `queue_sort`. Restored the defect in a temporary copy of `client/godot` outside the checkout (GUT 9.7.1, Godot 4.7.2, headless, with the `unit_test_core` pre/post run scripts) by replacing client/godot/core/tween_core/tween_core.gd:725 with `var arranged: bool = change.arranged`: 58 of 59 TweenCore tests pass and that test fails (`offset_transform_position` (0, 0) instead of (10, 0); `position` (10, 0) instead of (54, 0); origin (54, 0) instead of (64, 0)). Unchanged code: 59 of 59 pass |
| R1-2 | fixed | `test_rotation_and_scale_from_their_current_values_start_from_the_offset_of_an_arranged_element` (client/godot/core/tween_core/tests/test_arranged.gd:111) sets offset rotation 40° and offset scale (2, 3), plays `Rotation` to 0 and `Scale` to (1, 1) without start values, and asserts the midway values 20° and (1.5, 2). In the same temporary copy, replacing client/godot/core/tween_core/tween_core.gd:1035 with a read of `control.rotation` makes that test fail (0 instead of 20, 58 of 59 pass); separately, replacing line 1036 with `var s: Vector2 = control.scale` makes it fail (1 instead of 1.5 and 2, 58 of 59 pass) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- In the commit range, TweenCore changed only in `client/godot/core/tween_core/tests/test_arranged.gd`, which adds two tests; the implementation did not change. The other changes in the range (`bootstrap_core`, server core modules, `test-data/`, `records/`) are outside the target and were not reviewed
- The tests ran headless in a temporary copy with GUT options taken from `ogw core test` (`gutOptions`), but without the test run config (`ogw_run_id`, fixture dirs) that `ogw core test` passes. TweenCore tests do not read fixtures, and all 59 passed on the unchanged code. The `--web` run was not done
- The round 1 `## unknown` items (callers of TweenCore that tween a `Control` inside a `Container`, input at the moved place, `offset_transform_position_ratio`, re-deciding arranged per repeat cycle) were not checked again: the range did not change the code they point to
