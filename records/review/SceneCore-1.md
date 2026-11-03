# review SceneCore round 1

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

- The range 9b1e14b5..b0d0572a changes no file under client/godot/core/scene_core/, and core-spec/SceneCore.json is unchanged. Of the dependency modules (LogCore, EventCore, TimeCore, ResourceCore, PoolCore, SafeAreaCore, InputBlockCore, ScreenEffectCore, UICore, MessageCore), only MessageCore changes in the range. The other client changes of the range were read: bootstrap_core tests, localization_core (`list_languages` parameter type), payment_core (a comment), qa_core (settings reads removed) and generated settings
- MessageCore change: `show_black_box` lost its third parameter (client/godot/core/message_core/message_core.gd:128). SceneCore calls only `close_black_box`, which is unchanged (client/godot/core/scene_core/scene_core.gd:229). The one SceneCore test that calls `show_black_box` passes one argument (client/godot/core/scene_core/tests/test_transition.gd:61)
- Settings: `loadingScreen`, `SceneCore.loadingMinDisplayMs` and `SceneCore.prepareRetryCount` keep their values in client/godot/generated/core_settings.json across the range; only the line of `loadingScreen` moves. The settings removed from the generated file (`uiCheckScreens`, `uiQuality`) are not read by SceneCore. The reserved strings `[scene_prepare_failed]`, `[scene_retry]` and `[scene_restart]` are still generated (client/godot/generated/data/reserved_string.gd:383)
- Data tool changes (tools/data-tool/src/corespec.ts, tools/data-tool/src/godotgen.ts) were read for what SceneCore uses: SceneCore has no tables and its reserved rows have a null `rowOf`, so the table closure change does not reach them, and the vector list type change does not reach `ReservedString`. The data tool tests were not run
- `ogw core test godot SceneCore` reported `pass`. The output does not say whether the module ran again or a kept passing result was used. Tests of the modules that use SceneCore (among them BootstrapCore, ShortcutCore, TutorialCore, CutsceneCore, QACore) were not run, and the Web run (`ogw core test godot --web`) was not run
- records/review-debt/SceneCore.json holds D1, D2 and D3. This round's input `## debt` is `none`, so these items were not judged and stay in the list. The code they point to is unchanged in the range. They were not reproduced in this round
- client/godot/core/scene_core/scene_core.gd and its helper files were read, but because the range changes nothing there, the module was not checked item by item against client-core/modules/scene-core.md, and its `## test` items were not matched to tests in this round. The order of the hidden callback and the button callback of a system popup, which `_on_popup_hidden` relies on (client/godot/core/scene_core/scene_core.gd:506), was taken from the code comment and the passing tests of client/godot/core/scene_core/tests/test_retry_popup.gd, and UICore was not read for it
