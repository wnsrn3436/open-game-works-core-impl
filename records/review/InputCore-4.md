# review InputCore round 4

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R3-1 | fixed | `_read_sensitivities` now rejects an element more than `_MAX_SENSITIVITY` (10000, client/godot/core/input_core/input_core.gd:54) with an error log and returns empty, so `init` fails (client/godot/core/input_core/input_core.gd:2221-2223), as open-game-works-core/skills/client-core/modules/input-core.md:245 requires; the doc comment is updated (:2201-2203). `test_init_fails_with_sensitivities_out_of_range` (client/godot/core/input_core/tests/test_stick_axis.gd:113-137) adds [1000, 10001] and [1000, 3000000000], each asserting `init` fails with one error log and not initialized, and checks that [1, 1000, 10000] is accepted, listed in order and that `set_pad_axis_sensitivity("right_x", 10000)` stores 10000. The round 3 run of this file with [1000, 10001] added failed on the old code; `ogw core test godot InputCore --file client/godot/core/input_core/tests/test_stick_axis.gd` passes on HEAD |
| R3-2 | fixed | `items` of `InputCore.padAxisSensitivities` now has `"maximum": 10000` in settings/core-settings.schema.json:1310 and server/generated/core_settings_schema.json:1310, as open-game-works-core/skills/client-core/modules/input-core.md:261 says. The core settings value (settings/core-settings.json:490) [500, 750, 1000, 1500, 2000] meets it |
| R1-2 | fixed | An element more than 10000 is now refused by `init` (R3-1) and by the schema (R3-2), so a value that overflows `_axis_sensitivity: PackedInt32Array` can no longer be stored; the overflow input [1000, 3000000000] of the earlier finding now makes `init` fail in the test at client/godot/core/input_core/tests/test_stick_axis.gd:117 |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only client/godot/core/input_core/tests/test_stick_axis.gd was run (Godot, not `--web`). The whole InputCore suite and the dependent modules were not run here; the core agent report says they passed, and `ogw review run` runs the dependents after the fix
- No automated test exercises the new schema `maximum` through the settings check; it was checked by reading the two schema files
- Files of the commit range outside InputCore and the settings schema (BootstrapCore, ads-reward server tests, records of other targets) were not reviewed
- Behavior with real gamepad hardware was not checked
