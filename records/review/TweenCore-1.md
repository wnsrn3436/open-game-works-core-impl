# TweenCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | test evidence | medium | client/godot/core/tween_core/tween_core.gd:725 | In `_apply_end_state`, a change that has not started in this cycle decides arranged with `_is_arranged(object)`. Replacing `change.arranged if change.started else _is_arranged(object)` with `change.arranged` (so a skipped later-step `Position`/`Rotation`/`Scale` change of an arranged element writes `Control.position`/`rotation`/`scale`, which the parent overwrites when it arranges its children again) leaves all 57 tests of `res://core/tween_core` passing (run in a temporary copy of `client/godot` with GUT 9.7.1, Godot 4.7.2). No test skips an arranged element before a change of its later step starts | Add a test: on an arranged element, a definition with step 1 `Opacity` and step 2 `Position` (10, 0); `skip_to_end` during step 1; assert `offset_transform_position` is (10, 0), `position` is the place the parent gives, and both stay after `queue_sort` | no | 90 |
| R1-2 | test evidence | medium | client/godot/core/tween_core/tween_core.gd:1035 | `godot.md` arranged element row: "Its current value is read from the same properties". Only the `Position` read of an arranged element is tested (`test_a_change_from_its_current_value_starts_from_the_offset_of_an_arranged_element`). Changing the arranged `Rotation` read to `control.rotation` (line 1035) or the arranged `Scale` read to `control.scale` (line 1036) leaves all 57 TweenCore tests passing, because every test that tweens `Rotation`/`Scale` of an arranged element starts from offset rotation 0 and offset scale (1, 1), the same as `rotation`/`scale` | Add tests that set `offset_transform_rotation` and `offset_transform_scale` to non-default values on an arranged element, play `Rotation` and `Scale` changes that do not use the start value, and assert the midway values start from the offset values | no | 90 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The tests of the core callers of TweenCore (`message_core`, `ui_core`, `screen_effect_core`, `cutscene_core`) were not run with the change: outside the harness they fail on missing built data fixtures (`DataCore` built-in data at `res://build/data/`), so whether any of them tween a `Control` inside a `Container` and now get offset transform values was not checked by a run. Reading only showed `ui_core.gd:536` adds a `PanelContainer` band, not tweened by the lines checked
- "Where it takes input" of an arranged element is checked only through `get_transform()` (a mutant that drops `offset_transform_visual_only = false` fails those asserts); no test sends input at the moved place
- `offset_transform_position_ratio` of an arranged element is neither read nor written by TweenCore; the effect of a non-zero value set by content code was not checked
- Re-deciding arranged for each cycle of a repeating tween after the target moves to another parent was read in code (`reset_cycle` clears `started`, so a change re-decides in each cycle) but not judged against the spec, which does not say whether each cycle is a new start of a change
