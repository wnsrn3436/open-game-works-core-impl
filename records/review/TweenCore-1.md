# TweenCore review round 1

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

- The commit range changes TweenCore only in 742f043 (`get_finite_playing_count` in client/godot/core/tween_core/tween_core.gd:326 and the tests of non-member `TimeBasis`, `Easing` and `TweenValueKind`). The other commits of the range change other modules and records and were not checked for TweenCore
- The core tests were not run in this review. Running GUT needs the UnitTestCore test host that `ogw core test` starts, which this review does not start. The judgement that each new test fails on the defect it names was made by reading the code: removing the `repeat_count != 0` or `_active[slot] != 0` condition of `get_finite_playing_count` changes the count 4 asserted in client/godot/core/tween_core/tests/test_count.gd; freeing the slot after the callback in `_end` (client/godot/core/tween_core/tween_core.gd:710) changes `_counts_at_end`; setting the value tween record repeat count from its definition (client/godot/core/tween_core/tween_core.gd:271) makes the count 3; removing `_is_time_basis` (client/godot/core/tween_core/tween_core.gd:166, 190), `_is_easing` (client/godot/core/tween_core/tween_core.gd:240, 417, 888) or the `TweenValueKind` check (client/godot/core/tween_core/tween_core.gd:225) returns a valid handle, a played value or `true` from `check_definition` where the tests assert otherwise
- The no-allocation test of `get_finite_playing_count` (client/godot/core/tween_core/tests/test_count.gd:50) catches only allocations left behind, as open-game-works-core/skills/client-core/engines/godot.md:564 sets. The operation's loop (client/godot/core/tween_core/tween_core.gd:333) was read against the `## frame code` rules of that file and creates no collection, `Callable` or `String` outside its error log path
- QACore, the caller named in the spec, does not call `get_finite_playing_count` yet (its `finite_tweens` value). That is QACore work outside this target and was not reviewed
