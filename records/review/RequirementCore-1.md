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

- The commit range `d4e2728..c522a8d` changes no file of `client/godot/core/requirement_core/` and no file of `core-spec/RequirementCore.json`. Of the modules RequirementCore depends on (LogCore, EventCore, TimeCore, DataCore, LocalizationCore, UserStateCore, NetworkCore, UICore), only UICore changes: `client/godot/core/ui_core/ui_core.gd:653`-`:665` adds the read-only `is_flow_in_progress` (+15 -0) and `core-spec/UICore.json` lists it. It does not change `UIOpenedEvent` or `UIClosedEvent`, which are the only UICore parts RequirementCore uses (`requirement_core_node.gd:39`-`:44`, `requirement_core.gd:752`-`:753`)
- The other changes RequirementCore can reach are the test runner and settings. `client/godot/core/unit_test_core/dev/unit_test_core.gd` and `dev/gut_pre_run.gd` make the run send `PUT /started` and await it before the first test setup. The RequirementCore tests use only `UnitTestCore.check_logs`, `check_script_errors`, `set_test_settings`, `advance_clock`, `wait_frames` and `read_core_fixture`, and the range changes none of these. `client/godot/generated/core_settings.json` adds `QACore.captureJpgQuality` and `UnitTestCore.startTimeLimitMs` and renames `uiQuality.settleMs` to `settleLimitMs`. RequirementCore reads only `RequirementCore.maxBatchRounds` and `RequirementCore.timeRecheckMs` (`requirement_core.gd:105`-`:113`), and the range changes neither. So no change in the range reaches the target code or its tests, and I did not review the rest of the module code again
- I did not run the core tests
