# RealtimeCore review round 1

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

- The commit range d4c3ae7ff3f1ccc2ad43e6d4eddec40ce4a882f9..98654d9126066b38259e6e6aac6c34a423b77e81 changes no RealtimeCore code, test or spec (`client/godot/core/realtime_core/` and `core-spec/RealtimeCore.json` are not in the diff), no contract file (`proto/`), no server code (`server/`), and no code of the client modules in `## dependency` of the RealtimeCore spec. The changed code is in `client/godot/core/ui_core/`, `client/godot/core/qa_core/`, `client/godot/generated/core_settings.json` and `core-spec/UICore.json`
- `UICore` reaches RealtimeCore only indirectly: `AuthCore` and `NetworkCore` use it, and the RealtimeCore test setup starts it (`client/godot/core/realtime_core/tests/support/realtime_test_case.gd:128`). The change in `client/godot/core/ui_core/ui_core.gd` adds `is_dimmed` (`:750`), `_is_dimmed` (`:2374`) and `_dim_above` (`:2379`) and edits two section comments. No existing function changes, and the only non-test caller of `is_dimmed` is `client/godot/core/qa_core/dev/qa_query.gd:271`
- `QACore` calls RealtimeCore, and the opponent bot client of a realtime game uses RealtimeCore in the headless run of `QACore`. The one code change in `QACore` adds the `dimmed` field to `list_ui_json` (`client/godot/core/qa_core/dev/qa_query.gd:271`). It calls no RealtimeCore operation, and the RealtimeCore calls of `client/godot/core/qa_core/dev/qa_query.gd:65` are unchanged. The correctness of the `is_dimmed` result was not judged here, because it is outside this target
- The only change in `client/godot/generated/core_settings.json` removes a `maxFlatShare` key. No file outside `records/` names that key at the end of the range, and it is not a key of the settings table of the RealtimeCore spec
- Read only; the RealtimeCore tests were not run in this review, because no code they run changed behavior in the range. The unchanged RealtimeCore code was not reviewed again, because the range has no change that reaches it and input `## spec changes`, `## debt` and `## must fix` are `none`
