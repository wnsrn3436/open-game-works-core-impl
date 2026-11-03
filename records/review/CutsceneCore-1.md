# review CutsceneCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/cutscene_core/cutscene_core.gd:1411: medium Auto advance measures its wait from the turn-on click as well (`_auto_from_ms`, set at `cutscene_core.gd:1681`), while `open-game-works-core/skills/client-core/modules/cutscene-core.md:122` measures it from the later of the whole text being shown and voice end, and only a line history close restarts it (`cutscene-core.md:165`). Run path: typing interval 0, a `Line` without voice, the auto advance button clicked 5000 ms after `Line` start, `CutsceneCore.autoAdvanceDelayMs` 1500. By the spec the wait has already passed and the `Line` ends on the next frame; the code computes `from` as 5000 and ends it at 6500 ms. `tests/test_line.gd:201` clicks right after `Line` start, so it cannot tell the two apart
- client/godot/core/cutscene_core/cutscene_core.gd:1652: medium `_is_advance_binding` reads `InputCore.maxKeysPerAction` and `InputCore.maxPadButtonsPerAction` (`cutscene_core.gd:32`, `cutscene_core.gd:33`, `cutscene_core.gd:1650`) with `CoreSettings.get_int` during an advance button click. Neither key is in `## settings` of `open-game-works-core/skills/client-core/modules/cutscene-core.md:197` or in `core-spec/CutsceneCore.json`, although `## settings` lists the keys a module reads (`open-game-works-core/skills/core/SKILL.md:47`) and a module reads them in `init` (`open-game-works-core/skills/client-core/engines/godot.md:115`). No wrong result was found: both keys are in `client/godot/generated/core_settings.json`, and `InputCore` is a dependency of `CutsceneCore`
- client/godot/core/cutscene_core/cutscene_core.gd:293: medium Tween presets are kept in `_presets` from `await ResourceCore.load` in playback step 3 and read from that dictionary at command start (`cutscene_core.gd:1030`, `cutscene_core.gd:1045`, `cutscene_core.gd:1081`, `cutscene_core.gd:1169`). `open-game-works-core/skills/client-core/modules/cutscene-core.md:76` says the command gets the preloaded preset with `ResourceCore.get_loaded`(playback scope) at command start, and the module has no `get_loaded` call. No wrong result was found: the definition is not changed after step 3, because `Move` plays a copy

## debt

none

## must fix

none

## unknown

- `ogw core test godot CutsceneCore --file` passed on all 18 files of `tests/test_*.gd` on Godot 4.7.2, one file at a time. The module as a whole without `--file`, the browser run (`--web`) and the core tests of modules that depend on CutsceneCore were not run. An earlier attempt that started these runs in parallel failed before any test ran: some jobs had a wrong `--file` value, and the others failed with `ENOENT` in the data tool build under `server/build/data/`, which the parallel runs shared in this one checkout. That failure was not investigated further
- The three `## out of scope` problems come from reading the code and the specs. They were not reproduced by a run, and no temporary test was written for them
- The range changes no file of `client/godot/core/cutscene_core/`, `core-spec/CutsceneCore.json` or the modules it calls, other than `LocalizationCore.list_languages`, which CutsceneCore does not call. A search of `client/godot/core/cutscene_core/` finds no use of the other symbols the range changes or removes: `MessageCore.show_black_box`, `gamepadSupported`, `uiCheckScreens`, `uiQuality`, `supportedLanguages`, `AccessibilityCore.textScales`. So no target code was reached by the range, and the absence of findings rests on that
- The data tool change of `tools/data-tool/src/corespec.ts` was compared by running `coreDataOf` of the range start and of HEAD on the `core-spec/` of HEAD, for `CutsceneCore` alone and for its 27 module dependency closure: tables, enums, reserved names and invariants are the same. The change of `tools/data-tool/src/godotgen.ts` was judged from reading only: the three cutscene tables have no `array<vector<float>>` column
- The other files changed in the range (server core, `BootstrapCore`, `MessageCore`, `PaymentCore`, `QACore`, tools tests) belong to other review targets. Only the non-test diffs of `MessageCore`, `PaymentCore` and `QACore` were read, for an effect on CutsceneCore. The test diffs of those modules and of `BootstrapCore` and the server core diffs were not read
- `client/godot/core/cutscene_core/cutscene_core.gd` and the small classes `cutscene_actor.gd`, `cutscene_core_node.gd`, `cutscene_line_history_item.gd` and `cutscene_play_wait.gd` were read once to look for out of scope problems. This was not a check of every aspect against every spec line. `cutscene_view.gd`, `cutscene_command.gd`, `cutscene_staging.gd`, `cutscene_result.gd`, `cutscene_choice_record.gd`, `cutscene_history_entry.gd`, `events/cutscene_cue_event.gd`, `tools/data-tool/src/checks/CutsceneCore.ts` and the test files were not read in full, and the coverage of `## test` items by core tests was not checked
- Whether an implementation that differs from a spec line only by a project-wide pattern is a problem was not judged: `CutsceneActor`, `CutsceneLineHistoryItem` and the core node call `_` names of `CutsceneCore`, which `open-game-works-core/skills/client-core/engines/godot.md:157` does not allow outside the module class, its Dev class and its tests. Other modules, such as `SoundCore`, `TweenCore` and `UICore`, have the same pattern in their helper files
- Behavior that the spec does not set was not written as a problem: a `Line` that starts while the line history window is open (the list is not filled again and a replay voice can overlap the line voice), and a `Choice` whose only unlocked rows fall beyond the number of choice buttons (no button can be picked)
