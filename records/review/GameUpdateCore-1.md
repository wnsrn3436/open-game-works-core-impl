# review GameUpdateCore round 1

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

- Commit range d4c3ae7ff3f1ccc2ad43e6d4eddec40ce4a882f9..5a4503966b0a087e8d438ed3774f25b7d43998ee changes no file under client/godot/core/game_update_core/ and none under server/core/game-update/. Among the client modules the target depends on, only UICore changes. The code changes in the range are UICore `is_dimmed` with its private helpers `_is_dimmed` and `_dim_above`, the `dimmed` field of QACore `list_ui`, `is_dimmed` in core-spec/UICore.json, the removal of the unreferenced `maxFlatShare` line from client/godot/generated/core_settings.json, and UICore and QACore tests and test resources
- The ui_core.gd diff adds only those functions and edits two section comments, so `UICore.open_system_popup` (client/godot/core/game_update_core/game_update_core.gd:675) and the UICore operations that the target's test support calls (`get_layer`, `close_all_popups`, `get_open_popup_count`, `prepare`, `release`) are unchanged. grep finds no reference to `is_dimmed`, `list_ui`, QACore or `maxFlatShare` in client/godot/core/game_update_core/ or server/core/game-update/
- Because the range does not reach the behavior of the target, the GameUpdateCore code and the server `game-update` code were not reviewed beyond this reach check and the popup call above. The defining documents other than open-game-works-core/skills/client-core/modules/game-update-core.md and the `is_dimmed` and dim lines of open-game-works-core/skills/client-core/modules/ui-core.md were not read for this round, because input `## spec changes` is `none`
- The correctness of `is_dimmed` itself was not reviewed, because it is UICore code that the target does not call
- The GameUpdateCore tests were not run
