# review AuthCore round 1

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

- The range changes no AuthCore code, test or `core-spec/AuthCore.json`. It also leaves `client/godot/engine.json` and the code of `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `LocalizationCore`, `MessageCore`, `NetworkCore` and `UserStateCore` unchanged. Its code changes are the additive `UICore.is_dimmed` with its internals, the `QACore` `list_ui` field `dimmed`, tests and prefabs of those two modules, `core-spec/UICore.json`, and the removal of `uiQuality.maxFlatShare` from `client/godot/generated/core_settings.json`
- A search of `client/godot/core/auth_core/` found no use of `is_dimmed`, `dimmed`, `list_ui`, `is_modal_covered` or `maxFlatShare`. In AuthCore, only `_show_popup` and `_choose` (`client/godot/core/auth_core/auth_core.gd:1691-1745`) were read, because they call `UICore.open_popup` and `UICore.open_system_popup`, whose code the range does not change. The rest of AuthCore, its adapters, its tests and its native plugin were not read, so this review does not say that they match the defining documents
- `UICore.is_dimmed` and `qa_query.gd` belong to other targets. Their diff and `_layer_index_of` were read only to see whether they reach AuthCore. They do not, and this is not a review of those modules against `ui-core.md` or `qa-core.md`
- Whether the `UIPopup` root dim rule for system popups (`open-game-works-core/skills/client-core/modules/ui-core.md:461`) is implemented correctly was not checked here. The input `## spec changes` is `none`, and AuthCore only uses the `open_system_popup` result and the button and hidden callbacks
- No test was run by this review, because there was no finding to check. `records/1793645028102-update-core-mvzlxt6u5be5ef-runs.json` records a `ogw core test godot` command for the range that lists AuthCore. `records/1793645028102-update-core-mvzlxt6u5be5ef.md` states 22 modules passed and 3 skipped (`AccessibilityCore`, `NativeUiCore`, `QACore`) in the native run, and 25 of 25 in the `--web` run. These are that agent's records and were not reproduced
