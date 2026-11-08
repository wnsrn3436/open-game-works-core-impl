# review InputCore round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/input_core/input_core.gd:2081 | input-core.md:184 sets that `load_keys`, when it changes a stick axis option, first releases the pressed sources of `Gameplay` actions whose gamepad axis direction is of that stick axis. The code does this at input_core.gd:2081 (`_load_axis_inverted`) and input_core.gd:2117 (`_load_axis_sensitivity`), but no test goes through it: the only tests that call `load_keys` with saved stick axis options (client/godot/core/input_core/tests/test_stick_axis.gd:24, :230, :246) never press a stick axis before `load_keys`, and no other test file uses the stick axis options except test_lifecycle.gd, which does not press an axis either. Removing the `_release_stick_axis(axis)` call from either loader fails no test. Run path: `right_y` −0.6 presses `look_up`, saved `InputCore.pad_axis_inverted` [`right_y`], `load_keys` → the spec gives `is_pressed(look_up)` `false`, and nothing checks it | Add a test: press `look_up` with `right_y` −0.6 (and `look_right` with `right_x` 0.5), save `InputCore.pad_axis_inverted` [`right_y`] and `InputCore.pad_axis_sensitivity` [`right_x=2000`], call `load_keys`, and assert `is_pressed` is `false` for `look_up` and `look_right` and stays `true` for `menu_right` | no | 90 |
| R1-2 | correctness | medium | client/godot/core/input_core/input_core.gd:123 | input-core.md:261 and the schema (settings/core-settings.schema.json:1305-1316) allow any integer of 1 or more in `InputCore.padAxisSensitivities`, and `_read_sensitivities` keeps them as `PackedInt64Array`, but the selected sensitivity is stored in `_axis_sensitivity: PackedInt32Array` (input_core.gd:123, written at :542 and :2118). With `InputCore.padAxisSensitivities` [1000, 3000000000], `set_pad_axis_sensitivity("right_x", 3000000000)` returns `true` but stores −1294967296, so `get_pad_axis_sensitivity("right_x")` returns a negative number and `_axis_source_strength` (input_core.gd:1318) gives a negative strength, so `right_x` never presses `look_right`. The caller buffer of `list_pad_axis_sensitivities` is `PackedInt32Array` by skills/client-core/engines/godot.md:487, so input_core.gd:559 also wraps that value | Set an upper bound for the elements of `InputCore.padAxisSensitivities` in input-core.md (setting row and the `init` failure row) and in the core settings schema `maximum`, at most 2147483647, and check it in `_read_sensitivities` | yes | 80 |

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The core tests of InputCore were not run in this round; findings come from reading the code and tests of the commit range (client/godot/core/input_core/input_core.gd, tests/test_stick_axis.gd, tests/test_lifecycle.gd, tests/support/input_core_test_case.gd, core-spec/InputCore.json, settings/core-settings.json, settings/core-settings.schema.json)
- Behavior with real engine gamepad hardware (Godot `InputEventJoypadMotion` delivery when a stick stays still after an option change) was not checked
- Files of the commit range outside InputCore (other client and server modules) were not reviewed
