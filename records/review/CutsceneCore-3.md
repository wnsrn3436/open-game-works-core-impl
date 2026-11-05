# CutsceneCore review round 3

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R3-1 | spec | medium | client/godot/core/cutscene_core/tests/test_focus.gd:46 | The `## test` item added by the spec changes, `open-game-works-core/skills/client-core/modules/cutscene-core.md:283` (focus mode, advance button focused, `InputCore.set_keys`(`cutscene_advance`, [Space]): the Enter accept input gives one advance input and the Space accept input gives one advance input), has no test. No CutsceneCore test calls `InputCore.set_keys` (`grep set_keys client/godot/core/cutscene_core/` finds none); the focus tests use only the gamepad (`test_focus.gd:39` `start_gamepad`, `:125` `set_pad_buttons`), and the key tests of `tests/test_line.gd:92`, `:117` press Space with the default binding. The key path of `_is_advance_binding` (`client/godot/core/cutscene_core/cutscene_core.gd:1630`, a key not in the binding whose accept click is an advance input) is not exercised by any test | Add a test in `tests/test_focus.gd` that sets the keyboard device, focuses the advance button during a `Line`, calls `InputCore.set_keys(&"cutscene_advance", ["Space"])`, and checks that an Enter press and release ends exactly one line step (`_next` + 1) and that a Space press and release ends exactly one more | no | 95 |

## previous

| id | result | evidence |
|---|---|---|
| R2-1 | open | Its spec part is done: `## settings` of `open-game-works-core/skills/client-core/modules/cutscene-core.md:207`, `:208` now lists `InputCore.maxKeysPerAction` and `InputCore.maxPadButtonsPerAction`, as does `core-spec/CutsceneCore.json`. The code part is not: `init` checks and reads only `_TYPING_KEY`, `_AUTO_KEY`, `_FAST_FORWARD_KEY`, `_HISTORY_KEY`, `_MAX_DURATION_KEY` and `_VIEW_KEY` (`client/godot/core/cutscene_core/cutscene_core.gd:163`-`:179`). `_is_advance_binding` still reads the two keys with `CoreSettings.get_int` on each advance button click and sizes the buffer there (`cutscene_core.gd:1650`-`:1652`). The commit range does not touch `client/godot/core/cutscene_core/`. By `open-game-works-core/skills/client-core/engines/godot.md:115` a module reads its `## settings` keys in `init` and fails `init` with an error log when one is missing or not of its type. Here `init` with `InputCore.maxKeysPerAction` missing or not an integer (e.g. `UnitTestCore.set_invalid_test_settings`) succeeds. The fix no longer needs a spec change: read both keys and the default binding size of `cutscene_advance` in `init` (fail `init` on a missing key), and size the buffer from those values |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D2 | open | R2-1 | `client/godot/core/cutscene_core/cutscene_core.gd:32`, `:33`, `:1652` still read the two `InputCore` keys on an advance button click, and `init` (`cutscene_core.gd:163`) neither checks nor reads them, although `## settings` of `cutscene-core.md:207`, `:208` now lists them |

## must fix

none

## unknown

- No tests were run in this round. The commit range does not change `client/godot/core/cutscene_core/`, `camera_core`, `input_core` or `ui_core`, and both findings come from reading the code against the spec changes. The behavior of the new `cutscene-core.md:283` test item was checked by reading the code only: the default `cutscene_advance` binding in `client/godot/project.godot` is Space, Enter and pad `a`, and `_is_advance_binding` (`cutscene_core.gd:1626`) checks the event key name against `InputCore.get_keys`. It was not run
- The `CameraCore` spec changes (`move_by_preset` ends the follow at its call, `snap_to` applies the position inside the operation, the `Easing` failure) and the `UICore` spec changes (a system popup becomes visible after its tween presets load) were checked against the CutsceneCore code that uses them (`cutscene_core.gd:1128`-`:1160`, `:1264`, `:1288`, `:1719`-`:1740`). No CutsceneCore divergence was found. Whether `CameraCore` and `UICore` implement those changes belongs to their own reviews and was not checked
- In `cutscene_core.gd:1652`, `InputMap.action_get_events(&"cutscene_advance").size()` counts every event of the action, keys and gamepad inputs together. This was read as at least the "number of device inputs in the default binding" of `cutscene-core.md:207`, `:208`. Whether `InputCore` leaves out some input map events from the default binding was not checked
