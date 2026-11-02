# NetworkCore review round 1

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

- The commit range d4c3ae7ff3f1ccc2ad43e6d4eddec40ce4a882f9..7c07df7983e6d07545248f2afc7e5c7e17684c9c changes no NetworkCore code, test or spec: `git diff --stat` of the range on `client/godot/core/network_core/` and `core-spec/NetworkCore.json` is empty, and `## spec changes` is `none`. It is also empty on `LogCore`, `EventCore`, `TimeCore`, `DataCore`, `UserStateCore`, `InputBlockCore`, `MessageCore`, on `server/` (which holds the server dependencies `session` and `logging`), on `proto/`, on `settings/` and on `client/godot/engine.json`
- Of the modules in `## dependency`, only `UICore` changes. `client/godot/core/ui_core/ui_core.gd` removes no code: the only removed lines are two section comments, and the additions are `is_dimmed`, `_is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`), which read state and do not change it. The other `UICore` changes are tests, test prefabs, test support and `core-spec/UICore.json`
- NetworkCore calls `UICore.show_loading_icon`, `UICore.hide_loading_icon`, `UICore.get_block_pass_list` and `UICore.open_system_popup` (`client/godot/core/network_core/network_core.gd:710`, `client/godot/core/network_core/network_core.gd:736`, `client/godot/core/network_core/network_core.gd:1060`, `client/godot/core/network_core/network_core.gd:1085`), and the range does not change these operations. A search of `client/godot/core/network_core/` finds no use of `is_dimmed`, `_popup_dim`, `_panel_dim`, `list_ui` or `maxFlatShare`. The caller of `is_dimmed` outside the `UICore` and `QACore` tests is `client/godot/core/qa_core/dev/qa_query.gd:271`, a `QACore` query that does not call NetworkCore through this change, and `QACore` is not a NetworkCore dependency
- `client/godot/generated/core_settings.json` only loses `uiQuality.maxFlatShare`. The `NetworkCore.*` keys do not change, and NetworkCore code and tests do not read `uiQuality`. Whether the removal of that key is right was not checked, because the source of that file is outside this target
- The NetworkCore core tests were not run in this review, because there is no finding to check and the range changes nothing that NetworkCore code or its tests reach. This judgement comes from the diff and code search only
- NetworkCore code and tests were not compared line by line with `skills/client-core/modules/network-core.md`, because they are not changed in the range and the changes do not reach them. This review does not say that they match the defining documents
