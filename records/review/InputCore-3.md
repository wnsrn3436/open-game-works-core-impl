# review InputCore round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/input_core/input_core.gd:2215 | The `## spec changes` diff sets an upper bound: an element of `InputCore.padAxisSensitivities` more than 10000 makes `init` fail with an error log (open-game-works-core/skills/client-core/modules/input-core.md:245, :261). `_read_sensitivities` (client/godot/core/input_core/input_core.gd:2201-2222) rejects only elements less than 1, so `init` accepts any larger value. This is the same problem as R1-2: with [1000, 3000000000] `set_pad_axis_sensitivity("right_x", 3000000000)` still returns `true` and stores the value in `_axis_sensitivity: PackedInt32Array` (:123, :542) as −1294967296, so `_axis_source_strength` (:1323) gives a negative strength. Reproduced in a temporary worktree (`git worktree add --detach` of HEAD) by adding `PackedInt64Array([1000, 10001])` to the cases of `test_init_fails_with_sensitivities_out_of_range` (client/godot/core/input_core/tests/test_stick_axis.gd:113): `ogw core test godot InputCore --file client/godot/core/input_core/tests/test_stick_axis.gd` failed with "[1000, 10001]; [0] expected to equal [1]", meaning `init` succeeded and logged no error. No test covers the upper bound | In `_read_sensitivities`, reject an element more than 10000 with an error log, update the doc comment at :2199-2200, and add [1000, 10001] (with [1000, 10000] accepted) to `test_init_fails_with_sensitivities_out_of_range` | no | 95 |
| R3-2 | spec | medium | settings/core-settings.schema.json:1309 | open-game-works-core/skills/client-core/modules/input-core.md:261 (changed by the `## spec changes` diff) says each element is 1 to 10000 and "The core settings schema checks this range". The `items` schema of `InputCore.padAxisSensitivities` has only `"minimum": 1` and no `"maximum": 10000` (settings/core-settings.schema.json:1307-1310; the same in server/generated/core_settings_schema.json:1307-1310), so a game settings value such as [1000, 10001] passes the schema check | Add `"maximum": 10000` to `items` of `InputCore.padAxisSensitivities` in settings/core-settings.schema.json and regenerate server/generated/core_settings_schema.json | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R1-2 | open | The spec change it proposed was applied in this range with the bound 10000 (open-game-works-core/skills/client-core/modules/input-core.md:245, :261), but the code and the schema were not changed: no InputCore file and no `padAxisSensitivities` schema line is in the commit range. `_read_sensitivities` still accepts elements more than 10000, which was reproduced with [1000, 10001]. It continues as R3-1 (code and test) and R3-2 (schema) |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Only `client/godot/core/input_core/tests/test_stick_axis.gd` was run, and only in the temporary worktree with the added case. The whole InputCore suite and the modules that depend on InputCore were not run, because the commit range changes no InputCore code
- The godot.md hunk of the `## spec changes` diff (launch value file, browser shell, `res://generated/launch_values.json`) defines BootstrapCore and `core/web/ogw-shell.html`, which InputCore does not read. Those files were not reviewed
- Files of the commit range outside InputCore (BootstrapCore, UnitTestCore, SoundCore settings, server logging metrics, review records of other targets) were not reviewed
- Behavior with real gamepad hardware was not checked
