# review TutorialCore round 1

## findings

none

## previous

none

## out of scope

none

## debt

none

## must fix

none

## unknown

- The range 9b1e14b5..5e0826bf changes no file under client/godot/core/tutorial_core/, and core-spec/TutorialCore.json is unchanged. Of the dependency modules, only LocalizationCore changes in non-test code, and no file under client/godot/core/ of UICore, RequirementCore, NetworkCore, InputCore, InputBlockCore or SceneCore, nor test-data/, proto/, core-spec/tutorial.json or core-spec/RequirementCore.json, changes in the range. The dependency modules LogCore, EventCore, TimeCore, DataCore, ResourceCore, UserStateCore, AuthCore and SafeAreaCore are absent from the range's list of changed files
- LocalizationCore change: `list_languages` takes a `PackedInt32Array` (client/godot/core/localization_core/localization_core.gd:304). TutorialCore calls only `bind_text` and `unbind_text`, and no file under client/godot/core/ outside localization_core/ calls `list_languages`
- MessageCore change: `show_black_box` lost its third parameter (client/godot/core/message_core/message_core.gd:128). MessageCore is not a dependency of TutorialCore and client/godot/core/tutorial_core/ does not call it
- QACore change: the reads of `gamepadSupported`, `uiCheckScreens`, `supportedLanguages` and `AccessibilityCore.textScales` were removed from QACore and its core spec. TutorialCore keeps reading `gamepadSupported` (client/godot/core/tutorial_core/tutorial_core.gd:108). The key is still in client/godot/generated/core_settings.json:533 and client/godot/generated/core_settings_types.json:184 and still in the settings of core-spec/TutorialCore.json, so only its line moves. `tutorialView`, `TutorialCore.anchorWaitWarnMs` and `RequirementCore.timeRecheckMs` keep their values. `_SOFTLOCK_REASONS` of QACore still has `tutorial` (client/godot/core/qa_core/dev/qa_core.gd:46)
- Data tool changes: in tools/data-tool/src/corespec.ts the table closure now passes through `requirement`, whose only table reference is to itself (`children`, core-spec/RequirementCore.json), so it adds no table to a game that uses TutorialCore, and the only core enum of the `requirement` header, `RequirementLogic`, is one RequirementCore, a dependency of TutorialCore, already brings (`RequirementType` is set by the game). The vector list type in tools/data-tool/src/godotgen.ts does not reach the `tutorial` and `tutorial_step` tables, which have no vector column. client/godot/generated/data/ has no change in the range. These were checked by reading; `ogw core test tools` was not run
- `ogw core test godot TutorialCore` passed on the range head, with job output `TutorialCore pass` on two lines. The output does not say whether a line is a new run or a kept result. The browser run (`--web`) was not run, and the tests of the modules that use TutorialCore (among them QACore) were not run
- records/review-debt/TutorialCore.json holds D1 to D8. This round's input `## debt` is `none`, so these items were not judged and stay in the list. The code they point to is unchanged in the range. They were not reproduced in this round
- client/godot/core/tutorial_core/tutorial_core.gd and tutorial_core_node.gd were read, and client-core/modules/tutorial-core.md and server-core/modules/tutorial.md were read in full. Because the range changes nothing there, the module was not checked item by item against the spec, its `## test` items were not matched to tests, and the other files of tutorial_core/ and its tests were read only in part. The specs of the dependency modules, core/SKILL.md, core/command.md, client-core/SKILL.md and client-core/engines/godot.md were read only in the parts about TutorialCore, its operations and the core test command, not in full
