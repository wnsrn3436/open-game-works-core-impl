# review CutsceneCore round 1

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

- The commit range cf89b7fd..653334f changes no CutsceneCore file (client/godot/core/cutscene_core/), no CutsceneCore spec (core-spec/CutsceneCore.json, skills/client-core/modules/cutscene-core.md) and no CutsceneCore data check (tools/data-tool/src/checks/CutsceneCore.ts). It changes no client module in `## dependency` of the CutsceneCore spec (skills/client-core/modules/cutscene-core.md:21). The client changes of the range are listed below, with how they reach CutsceneCore:
  - QACore (client/godot/core/qa_core/dev/qa_core.gd:18-19, :822-825, client/godot/core/qa_core/dev/qa_telemetry.gd:156-159): release inputs go to `add_release` instead of telemetry `inputs`. QACore is not a CutsceneCore dependency; CutsceneCore code does not refer to it, and the CutsceneCore tests name it only in a comment (client/godot/core/cutscene_core/tests/test_focus.gd:60-61). `inject_at_frame_start` there uses `InputCoreDev.inject_device_input`, which the range does not change
  - AuthCore test of the secure storage plugin and the new `ogw-secure-storage` plugin (client/godot/core/auth_core/tests/test_secure_storage_plugin.gd, client/godot/plugins/ogw-secure-storage/, client/godot/engine.json:55-60): CutsceneCore code does not refer to AuthCore or secure storage
  - Generated settings (client/godot/generated/core_settings.json:95, :484-485, core_settings_types.json:537-538): only `routing.ipRateLimitPerMinute`, `storage.sweepBatchSize` and `storage.sweepTableBudgetMs` change, which are server settings that CutsceneCore code does not read
- The other changes of the range are server modules, core specs of `ads-reward` and `storage`, settings, records and README files, none of which CutsceneCore code calls or reads
- The CutsceneCore tests were not run in this review (`ogw core test` needs the GUT setup and the test host). Whether they pass at 653334f is not checked here
