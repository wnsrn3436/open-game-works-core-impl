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

- The commit range 625ae189..343f9726 changes no file of `client/godot/core/requirement_core/`, `core-spec/RequirementCore.json`, `fixtures/requirement-evaluation.json`, `tools/data-tool/`, `server/core/validation/` or `settings/core-settings.json`; the only `settings/core-settings.schema.json` change is `admin-api.maxSearchRows`. Input `## spec changes` is `none`. The range changes no file of `event_core`, `time_core`, `user_state_core`, `ui_core`, `log_core` or `localization_core`.
- Changes in the range that reach RequirementCore were checked for their effect on it: `client/godot/core/bootstrap_core/bootstrap_core.gd` `_release_entry` now calls `release` of modules that are not initialized. `RequirementCore.release` of a module that is not initialized has a null `_node`, skips `EventCore.unsubscribe_all` and only runs `_reset` (`client/godot/core/requirement_core/requirement_core.gd:132`, `:905`), and RequirementCore keeps no value set before `init`, so nothing changes for it. `client/godot/core/data_core/data_core.gd` `release` of a module that is not initialized now resets the built-in data location, and `client/godot/core/network_core/network_core.gd` `release` of a module that is not initialized now drops the transport. RequirementCore reads neither; its test `after_each` (`client/godot/core/requirement_core/tests/support/requirement_test_case.gd:68`) releases `DataCore` after the test body, and `UnitTestCore._register_replacements` registers the replacements again before the next test. The removal of `UnitTestCore._clear_pre_init_values` is covered by `TimeCore.release` now being called by `shutdown`. No problem found.
- `ogw core test godot RequirementCore` was run on this checkout: pass.
