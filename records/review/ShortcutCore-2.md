# ShortcutCore review round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | New test `test_a_scene_transition_after_closing_popups_stops_with_a_warning` (client/godot/core/shortcut_core/tests/test_errors.gd:152): a popup hidden callback starts `SceneCore.change_scene` without awaiting it, with no panel transition (`UICore.is_panel_transitioning()` asserted `false`). Restored the defect in a temporary `git worktree` of fc21c9a outside this checkout by removing `SceneCore.is_transitioning() or` from client/godot/core/shortcut_core/shortcut_core.gd:112; `ogw core test godot ShortcutCore --file client/godot/core/shortcut_core/tests/test_errors.gd` failed on this test (`[0] expected to equal [1]`, the warn count). Unmodified, the same run passed |
| R1-2 | fixed | Rows `plain_top_b`, `plain_top_bc`, `plain_top_empty` added (test-data/data/tables/shortcut.csv:32 to :35) and tests navigating from `SCENE_ROOT` into the plain scene: client/godot/core/shortcut_core/tests/test_stack.gd:91 (`Top` acts as `Root`, clear stack on, stack `b` / `b,c`), test_stack.gd:113 (`Root`), test_empty_panels.gd:46 (empty `panels` after a scene change: stack `x` that the new scene's `on_start` opened, shortcut-core.md stack rule). Restored the defect in a temporary worktree by changing shortcut_core.gd:129 to `row.stack != GameData.ShortcutStack.TOP and root_key == ""`; the `--file` run of test_stack.gd failed on `test_top_into_a_scene_without_a_root_panel_opens_with_clear_stack` (`["x,b"] expected to equal ["b"]`, `["x,b,c"] expected to equal ["b,c"]`). Unmodified, it passed |
| R1-3 | open | shortcut_core.gd:121 to :128 unchanged in the range, and `## spec changes` is `none`: stage 7 still calls `UICore.close_panels_to(root_key)`, whose destination is the topmost item with that key (open-game-works-core/skills/client-core/modules/ui-core.md:183), so a stack r,a,r with `root_c` still ends r,a,r,c instead of r,c (open-game-works-core/skills/client-core/modules/shortcut-core.md:66). The core agent report gives it as a spec proposal only (records/1793818580766-review-fix-mw2h9na6501524.md `## spec proposals`); still needs a spec decision |
| R1-4 | fixed | New test `test_release_while_closing_popups` (client/godot/core/shortcut_core/tests/test_release.gd:67): a popup hidden callback calls `ShortcutCore.release()` inside stage 5 of `navigate(change_bc)`. Restored the defect in a temporary worktree by deleting shortcut_core.gd:110 and :111; the `--file` run of test_release.gd failed on this test (scene `scene/shortcut_test_root_other` instead of `scene/shortcut_test_root`, `scene_ended:` and flow counts 1 instead of 0, stack `r` instead of `r,a`). Unmodified, it passed |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | fixed | none | Same as R1-1: test_errors.gd:152 goes through the `SceneCore.is_transitioning` condition of shortcut_core.gd:112 and fails when it is removed |
| D2 | fixed | none | Same as R1-2: test_stack.gd:91, test_stack.gd:113 and test_empty_panels.gd:46 change the scene at stage 6 into a scene without a root panel, with `Top`, `Root` and empty `panels`; the `Top` mutation of shortcut_core.gd:129 fails test_stack.gd:91 |
| D3 | open | R1-3 | Code at shortcut_core.gd:121 to :128 and the stage 7 / `close_panels_to` rules of shortcut-core.md and ui-core.md unchanged |
| D4 | fixed | none | Same as R1-4: test_release.gd:67 releases inside stage 5 and fails when shortcut_core.gd:110 and :111 are deleted |

## must fix

none

## unknown

- The commit range changes many modules (server core modules, AdCore, BadgeCore, CutsceneCore and others); only the ShortcutCore files (the four test files, test-data/data/tables/shortcut.csv and the generated ID entries in client/godot/dev/generated/data/game_data_dev.gd) were reviewed. No module ShortcutCore depends on (LogCore, EventCore, DataCore, LocalizationCore, RequirementCore, MessageCore, UICore, SceneCore) changed in the range
- Mutation runs used `ogw core test godot ShortcutCore --file` on single test files (native run only, not `--web`, not the whole module suite). The core agent report states 56/56 pass for the whole module, native and `--web`; that was not re-run here
- test_empty_panels.gd:46 is not caught by a mutation of its own: with empty `panels` in a scene without a root panel, `Top` and `Root` take the same path (stages 7 and 8 skipped), as the core agent report says. It asserts the stage 9 stack that shortcut-core.md:67 sets
