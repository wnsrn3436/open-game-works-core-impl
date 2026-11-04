# CutsceneCore review round 2

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R2-1 | spec | medium | client/godot/core/cutscene_core/cutscene_core.gd:1652 | Debt D2, written anew because R1-2 is withdrawn (its `spec change` was wrong). `_is_advance_binding` reads `InputCore.maxKeysPerAction` / `InputCore.maxPadButtonsPerAction` (`cutscene_core.gd:32`, `:33`) with `CoreSettings.get_int` on an advance button click, and neither key is in `## settings` of `open-game-works-core/skills/client-core/modules/cutscene-core.md:197` (`open-game-works-core/skills/core/SKILL.md:47`, `open-game-works-core/skills/client-core/engines/godot.md:115`). Only a spec change can remove the difference: `InputCore` has no operation that gives the binding size or matches an event to a binding (`open-game-works-core/skills/client-core/modules/input-core.md:25-58`); `InputCore` keeps bindings in its own state after reading the input map once at `init` (`client/godot/core/input_core/input_core.gd:118`, `:1949`), so `InputMap.action_get_events` does not bound a binding changed by `set_keys`; `set_keys` bounds it only by `InputCore.maxKeysPerAction` (`input-core.md:159`); and a buffer smaller than the binding leaves an error log (`input_core.gd:1769`, `godot.md:478`). No wrong result: both keys are in `client/godot/generated/core_settings.json` | Add `InputCore.maxKeysPerAction` and `InputCore.maxPadButtonsPerAction` to `## settings` of `cutscene-core.md` (as the core agent report `## spec proposals` says), then read them in `init` and size the buffer there | yes | 85 |

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `_on_auto_click` no longer sets `_auto_from_ms` (`client/godot/core/cutscene_core/cutscene_core.gd:1675`); it is set only at `Line` start (`:1346`) and line history close (`:1846`), and the wait at `:1411` is the later of whole text, voice end and those. Restored the defect in a local clone of this checkout outside it (`cutscene_core.gd` replaced with its `e02d2bf` version, tests of `b1dfb06`): `ogw core test godot CutsceneCore --file client/godot/core/cutscene_core/tests/test_line.gd` failed `test_auto_advance_turned_on_after_its_delay_ends_the_line_in_the_next_frame` and `test_auto_advance_turned_on_during_its_delay_ends_the_line_at_the_delay_from_voice_end`; on `b1dfb06` the same file passed |
| R1-2 | withdrawn | The dispute is right: a code-only fix is not possible under the current spec (no `InputCore` operation for the binding size, bindings kept in `InputCore` state rather than the input map at `client/godot/core/input_core/input_core.gd:118`, overflow error at `input_core.gd:1769`), so the finding's `spec change` `no` was wrong. The problem remains and is written anew as R2-1 with `spec change` `yes` |
| R1-3 | fixed | `_preset` gets the preset with `ResourceCore.get_loaded`(key, `TweenCore.get_preset_kind()`, `_scope`) (`client/godot/core/cutscene_core/cutscene_core.gd:1028`), called once at each of `Move`, `Camera`, `ScreenEffect` start (`:1076`, `:1139`, `:1164`); `_presets` is removed and step 3 no longer `load`s tween items (`:292`). Restored the defect in the same local clone (`e02d2bf` `cutscene_core.gd`): `ogw core test godot CutsceneCore --file client/godot/core/cutscene_core/tests/test_start_check.gd` failed `test_a_move_gets_its_tween_preset_with_get_loaded_at_command_start` (1 error log, hero not at `spot_b`); on `b1dfb06` the same file passed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1 in `## previous`: `client/godot/core/cutscene_core/cutscene_core.gd:1675` no longer restarts the wait, and the two new tests in `tests/test_line.gd` fail when the restart is restored |
| D2 | open | R2-1 | `client/godot/core/cutscene_core/cutscene_core.gd:32`, `:33`, `:1652` still read the two `InputCore` keys, and `## settings` of `cutscene-core.md` still does not list them |
| D3 | fixed | none | Same as R1-3 in `## previous`: the module gets presets with `ResourceCore.get_loaded` at command start (`client/godot/core/cutscene_core/cutscene_core.gd:1028`), and the new test in `tests/test_start_check.gd` fails when the step 3 result is kept again |

## must fix

none

## unknown

- Only `tests/test_line.gd` and `tests/test_start_check.gd` of CutsceneCore were run (native run, with `--file`), on `b1dfb06` and with the pre-fix `cutscene_core.gd` restored; the other CutsceneCore test files, the browser run (`--web`) and dependent modules were not run by this review (the core agent report says `ogw core test godot CutsceneCore BootstrapCore QACore UnitTestCore` and `--web` passed)
- The R1-3 test only swaps the tween fallback after step 3; a preset that did load and is replaced in the cache after step 3 is not tested (test code cannot reach `ResourceCore` internals). The code path is the same `get_loaded` call
- Extra `ResourceCore` error logs for a preset key that failed in step 3 and is then requested with `get_loaded` were not counted against `open-game-works-core/skills/client-core/modules/resource-core.md:120`, `:122`; this is `ResourceCore` behavior, and the CutsceneCore spec requires the `get_loaded` call
