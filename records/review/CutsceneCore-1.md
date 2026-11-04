# CutsceneCore review round 1

## findings

| id | aspect | severity | location | evidence | fix | spec change | confidence |
|---|---|---|---|---|---|---|---|
| R1-1 | spec | medium | client/godot/core/cutscene_core/cutscene_core.gd:1411 | Debt D1. The auto advance wait is `now - maxi(maxi(_full_at_ms, _voice_end_ms), _auto_from_ms)`, and `_on_auto_click` sets `_auto_from_ms = _clock()` (`cutscene_core.gd:1681`), so turning auto advance on restarts the wait. `open-game-works-core/skills/client-core/modules/cutscene-core.md:122` measures it from the later of the whole text being shown and voice end; only a line history close restarts it (`cutscene-core.md:165`, `cutscene_core.gd:1848`). Run path: `CutsceneCore.typingIntervalMs` 0, a `Line` without voice, `CutsceneCore.autoAdvanceDelayMs` 1500, auto advance button clicked 5000 ms after `Line` start. By the spec the `Line` ends on the next frame; the code ends it at 6500 ms. `tests/test_line.gd:201` taps the button right after `Line` start, so it does not tell the two apart | Do not set `_auto_from_ms` in `_on_auto_click` (keep it set at `Line` start and on line history close), and add a test that turns auto advance on after the delay has passed since the whole text and voice end and expects the `Line` to end on the next frame | no | 90 |
| R1-2 | spec | medium | client/godot/core/cutscene_core/cutscene_core.gd:1650 | Debt D2. `_is_advance_binding` reads `InputCore.maxKeysPerAction` / `InputCore.maxPadButtonsPerAction` (`cutscene_core.gd:32`, `cutscene_core.gd:33`) with `CoreSettings.get_int` on an advance button click. Neither key is in `## settings` of `open-game-works-core/skills/client-core/modules/cutscene-core.md:197` or in `core-spec/CutsceneCore.json`, while `open-game-works-core/skills/core/SKILL.md:47` says `## settings` lists the keys a module reads and `open-game-works-core/skills/client-core/engines/godot.md:115` says a module reads them in `init`. No wrong result: both keys are in `client/godot/generated/core_settings.json:295`, `:296` | Size the buffer without reading another module's settings (e.g. an `InputCore` operation or a size that does not need the keys), or add the two keys to the spec `## settings` and read them in `init` | no | 85 |
| R1-3 | spec | medium | client/godot/core/cutscene_core/cutscene_core.gd:1030 | Debt D3. Tween presets are kept in `_presets` from `await ResourceCore.load` in playback step 3 (`cutscene_core.gd:293`, `cutscene_core.gd:307`) and read from that dictionary at command start by `_preset`. `open-game-works-core/skills/client-core/modules/cutscene-core.md:76` says the command gets the preloaded preset with `ResourceCore.get_loaded`(playback scope) at command start; `grep get_loaded client/godot/core/cutscene_core/*.gd` finds no call in the module (only in tests). No wrong result found: `Move` plays a copy, so the kept definition is not changed after step 3 | Get the preset with `ResourceCore.get_loaded`(key, `TweenCore.get_preset_kind()`, playback scope) at command start, or change the spec to allow keeping the step 3 load result | no | 85 |

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | open | R1-1 | The commit range is empty; `cutscene_core.gd:1681` still sets `_auto_from_ms` on the auto advance click and `cutscene_core.gd:1411` still uses it in the wait |
| D2 | open | R1-2 | `cutscene_core.gd:32`, `:33`, `:1650` still read the `InputCore` keys; `core-spec/CutsceneCore.json` and the spec `## settings` still do not list them |
| D3 | open | R1-3 | `cutscene_core.gd:1030` still reads `_presets`; the module has no `ResourceCore.get_loaded` call |

## must fix

none

## unknown

- The commit range `e02d2bf..e02d2bf` is empty, so no changed code was reviewed; only the positions of the input `## debt` items were checked
- No tests were run: no finding is a test failure, and no defect was restored (round 1)
