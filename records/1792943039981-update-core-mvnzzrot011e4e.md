# update core: TweenCore (client, Godot) arranged element

## done

- TweenCore (Godot), `client/godot/core/tween_core/`: arranged element (`tween-core.md` `## type`; `godot.md` `TweenCore` row "arranged element"). Cherry-picked from f66e9c5 (branch `agent/mvnzmr1l3cb2d4`) and checked against spec f933d1c
  - `tween_core.gd` `_is_arranged`: a `Control` whose parent is a `Container`. Decided once when a change starts in a cycle (`_set_step_values`) and kept in `change_state.gd` `arranged` until it ends, also when the target moves to another parent. A change that has not started when the end state is applied is decided at that time
  - `_read` / `_write` / `_write_offset`: `Position`, `Rotation` (radians of the degrees), `Scale` of an arranged element go to `offset_transform_position` / `offset_transform_rotation` / `offset_transform_scale`, with `offset_transform_enabled` `true`, `offset_transform_visual_only` `false`, and `offset_transform_pivot` / `offset_transform_pivot_ratio` set from `pivot_offset` / `pivot_offset_ratio` on each write. The current value is read from the same properties
- Core tests `client/godot/core/tween_core/tests/test_arranged.gd`: the new `## test` item (`Position` (10, 0) in an `HBoxContainer` drawn 10 to the right, place unchanged after re-sort; `Scale` (1.2, 1.2) stays after re-sort), the same transform as a non-arranged `Control` about the pivot, the decision kept after reparenting, and a change from the current value starting from the offset
- `ogw core test godot` and `ogw core test godot --web` with TweenCore and all modules of `ogw core dependents TweenCore`: all pass. `ogw code check core`: pass

## spec proposals

none

## review

none

## unverified

none
