# review InputCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | client/godot/core/input_core/tests/test_stick_axis.gd:246 `test_load_keys_releases_the_sources_of_changed_axes` presses `look_up` (`right_y` −0.6) and `look_right` (`right_x` 0.5), saves `InputCore.pad_axis_inverted` [`right_y`] and `InputCore.pad_axis_sensitivity` [`right_x=2000`], calls `load_keys` and asserts `look_up` and `look_right` are released and `menu_right` (`Ui`) stays pressed, as input-core.md:184 sets. Restored in two worktrees made by `git worktree add --detach` from HEAD: (1) removed `_release_stick_axis(axis)` from `_load_axis_inverted` (client/godot/core/input_core/input_core.gd:2081): `ogw core test godot InputCore --file client/godot/core/input_core/tests/test_stick_axis.gd` failed with "the inversion of right_y releases look_up"; (2) removed it from `_load_axis_sensitivity` (client/godot/core/input_core/input_core.gd:2117): the same command failed with "the sensitivity of right_x releases look_right". The same command on the unchanged checkout passed |
| R1-2 | open | Not changed in the commit range: the commit range changes no InputCore code and `## spec changes` is `none`. input-core.md:261 and :245 still allow any element of 1 or more in `InputCore.padAxisSensitivities`, `_read_sensitivities` keeps them in `_sensitivities: PackedInt64Array` (client/godot/core/input_core/input_core.gd:120), and the selected value is still stored in `_axis_sensitivity: PackedInt32Array` (client/godot/core/input_core/input_core.gd:123, written at :542 and :2118). With `InputCore.padAxisSensitivities` [1000, 3000000000], `set_pad_axis_sensitivity("right_x", 3000000000)` returns `true` and stores −1294967296, so `_axis_source_strength` (client/godot/core/input_core/input_core.gd:1323) gives a negative strength. The core agent report proposes the spec change (upper bound 2147483647 in input-core.md and the core settings schema); it is not applied yet. Severity medium, `spec change` yes |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `client/godot/core/input_core/tests/test_stick_axis.gd` of InputCore was run (unchanged and with the two restored defects); the whole InputCore suite and the modules that depend on InputCore were not run in this round, since the commit range adds only one test to InputCore
- Behavior with real gamepad hardware was not checked; the tests use injected `InputEventJoypadMotion`
- Files of the commit range outside InputCore (TimeCore, QACore tests, review records of other targets) were not reviewed
