# SceneCore review round 1

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

- The commit range d4c3ae7f..e54bdd52 changes no file under `client/godot/core/scene_core/`, and `## spec changes` is `none`. The changes in that range outside `records/` were checked: `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/qa_core/dev/qa_query.gd`, `client/godot/generated/core_settings.json`, `core-spec/UICore.json`, and the test files of `ui_core` and `qa_core`. None of them changes a SceneCore setting, a call that SceneCore makes, or a behavior that SceneCore relies on:
  - UICore: only the new query `is_dimmed` and its internals `_is_dimmed` and `_dim_above` were added (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`). Its only caller outside the tests is `client/godot/core/qa_core/dev/qa_query.gd:271`, and SceneCore does not call it. `open_root_panel`, `reset_panel_stack`, `set_panel_lock`, `close_all_popups`, `open_system_popup`, `get_layer` and `get_block_pass_list`, which SceneCore calls, are unchanged. The new code only reads `_panel_dim` and `_popup_dim` and does not change the dim
  - QACore: `list_ui` gained the field `dimmed`. SceneCore does not read it
  - Settings: `client/godot/generated/core_settings.json` lost `uiQuality.maxFlatShare`. No file under `client/godot/core/scene_core/` reads `uiQuality`, and `settings/core-settings.json` has no such key
  - Test files: the added resource keys in `client/godot/core/ui_core/tests/support/ui_test_case.gd` and `client/godot/core/qa_core/tests/support/qa_test_case.gd` are not used by the SceneCore tests, which have their own support files in `client/godot/core/scene_core/tests/support/`
- Dependency spec `open-game-works-core/skills/client-core/modules/ui-core.md` was changed by the harness commits of the same work (dim rules, system popup dim). `scene-core.md` was not changed. The retry popup opens through `open_system_popup` with no dim or tween setting of its own (`client/godot/core/scene_core/scene_core.gd:469`), so the changed rules leave nothing for SceneCore to do. The SceneCore tests do not mention a dim
- The tests were not run in this review, since no finding needed checking. The run log `records/1793645028102-update-core-mvzlxt6u5be5ef-runs.json` of the change has a run of 25 modules that includes SceneCore: `ogw core test godot ... --web` exit code 0 with 1861 of 1861 tests passed. The native run has exit code 1 with 1861 of 1861 passed, and its report `records/1793645028102-update-core-mvzlxt6u5be5ef.md` names three skipped modules, `AccessibilityCore`, `NativeUiCore` and `QACore`, none of them SceneCore
- `client/godot/core/scene_core/scene_core.gd` and `client/godot/core/scene_core/scene_core_node.gd` were read to see what the changes reach, and nothing to report came from that reading. They were not reviewed item by item against every `## test` item of the spec, and the files in `client/godot/core/scene_core/tests/` were not read beyond searching them for a dim, since problems that existed before the range and are unrelated to its changes are not in scope of this round
