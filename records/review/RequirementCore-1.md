# review RequirementCore round 1

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

- The commit range `cf89b7f..4bb05ea` changes no file of `client/godot/core/requirement_core/` and does not change `core-spec/RequirementCore.json`. It changes no file of the modules RequirementCore depends on (`log_core`, `event_core`, `time_core`, `data_core`, `localization_core`, `user_state_core`, `network_core`, `ui_core`), and no file of `client/godot/core/unit_test_core/`. So `RequestCompletedEvent`, `UIOpenedEvent` and `UIClosedEvent`, the only NetworkCore and UICore parts RequirementCore uses (`requirement_core.gd:750`-`:753`, `requirement_core_node.gd:35`-`:44`), are unchanged
- The client changes in the range are in other modules and settings. `client/godot/core/qa_core/dev/qa_core.gd:18`, `:822`-`:825` and `qa_telemetry.gd:157`-`:158` record release inputs separately in QA telemetry; RequirementCore does not refer to QACore. `client/godot/engine.json:55`-`:60` and `client/godot/plugins/ogw-secure-storage/` add a macOS secure storage plugin that only `client/godot/core/auth_core/tests/test_secure_storage_plugin.gd` uses; no file under `client/godot/core/` outside `auth_core` refers to it. `client/godot/generated/core_settings.json` changes `routing.ipRateLimitPerMinute` and adds `storage.sweepBatchSize` and `storage.sweepTableBudgetMs`, all server keys; RequirementCore reads only `RequirementCore.maxBatchRounds` and `RequirementCore.timeRecheckMs` (`requirement_core.gd:9`-`:10`), and the range changes neither. The other changes are server core (`ads-reward`, `routing`, `storage` and some tests), `core-spec/ads-reward.json`, `core-spec/storage.json`, `licenses.json`, READMEs and `records/`. So no change in the range reaches the target code or its tests, and I did not review the rest of the module code again
- I did not run the core tests
