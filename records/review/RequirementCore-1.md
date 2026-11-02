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

- The commit range `d4c3ae7..0ebf2f2` changes no file of `client/godot/core/requirement_core/` and does not change `core-spec/RequirementCore.json`. It changes no file of `log_core`, `event_core`, `time_core`, `data_core`, `localization_core`, `user_state_core`, `network_core` and `unit_test_core`, and nothing under `server/`, `fixtures/`, `test-data/` or `settings/`. So I did not review the rest of the module code again
- `ui_core`, a dependency, changes in the range: `client/godot/core/ui_core/ui_core.gd:750`-`:755` and `:2374`-`:2382` add `is_dimmed` and its helpers. No other code of that file changes except two section comments. RequirementCore uses only `UIOpenedEvent` and `UIClosedEvent` of UICore (`client/godot/core/requirement_core/requirement_core.gd:752`-`:753`, `client/godot/core/requirement_core/requirement_core_node.gd:39`-`:44`), and the code that publishes them (`client/godot/core/ui_core/ui_core.gd:1507`, `:1515`) is unchanged. The only caller of `is_dimmed` outside `ui_core` is `client/godot/core/qa_core/dev/qa_query.gd:271`, and RequirementCore does not refer to QACore
- The test support changes in the range (`client/godot/core/ui_core/tests/support/ui_test_case.gd`, `client/godot/core/qa_core/tests/support/qa_test_case.gd`) are not used by the RequirementCore tests
- `client/godot/generated/core_settings.json` only removes `maxFlatShare`. RequirementCore reads only `RequirementCore.maxBatchRounds` and `RequirementCore.timeRecheckMs` (`client/godot/core/requirement_core/requirement_core.gd:9`-`:10`), and the range changes neither
- The other changes in the range are `client/godot/core/qa_core/`, `client/godot/core/ui_core/tests/`, `core-spec/UICore.json` and `records/`. None of them reaches the target code or its tests
- I did not run the core tests
