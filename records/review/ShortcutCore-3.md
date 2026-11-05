# ShortcutCore review round 3

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-3 | open | Severity medium. client/godot/core/shortcut_core/shortcut_core.gd:121 to :128 unchanged in the range. The spec change adds static check `shortcut root panel` (open-game-works-core/skills/client-core/modules/shortcut-core.md:42), which blocks the two shortcut row shapes named in D3 (`Top` row holding the root key, `Root` row R, B). It does not cover a stack in which content code pushed a second root-key item: `UICore.open_panel` of the root key while another panel is current pushes one (open-game-works-core/skills/client-core/modules/ui-core.md:164), and stage 7 still closes to the topmost item with that key (ui-core.md:183), so the stage 9 stack differs from shortcut-core.md:67 (`panels` on top of the root item, or one root item). Reproduced in a temporary worktree of c1f7455 outside this checkout with a scratch test: `start_at(SCENE_ROOT, [PANEL_A, PANEL_R])` (direct `UICore.open_panel` calls) gives stack r,a,r; `navigate(root_c)` returned `true` with stack `r,a,r,c` (expected `r,c`), `navigate(root_r)` returned `true` with stack `r,a,r` (expected `r`). Solved only by a spec change: a `UICore` way to close to the root item, a `UICore` rule that keeps the root panel key from being pushed above the root item, or a shortcut-core.md:67 result for such a stack |

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D3 | open | R1-3 | The static check of shortcut-core.md:42 removes the shortcut-row causes, but the stage 7 / `close_panels_to` behavior is unchanged and a stack r,a,r made by content code `UICore.open_panel` still ends `r,a,r,c` for `root_c` (reproduction in R1-3) |

## must fix

none

## unknown

- ShortcutCore code and tests did not change in the range. Of the modules it depends on, only SceneCore code changed (scene holder hiding, client/godot/core/scene_core/scene_core.gd); those changes were not reviewed line by line, but the whole ShortcutCore suite (`ogw core test godot ShortcutCore`, native only, not `--web`) passed at c1f7455 in a temporary worktree
- The UICore spec changes in `## spec changes` (`open_panels` replacement of a non-root item, close flow over a destination that is not a panel class, `PanelFlowFinishedEvent` payload) are not used by name in ShortcutCore code; shortcut-core.md:66 defers stage 8 replacement to UICore as it is. Whether the UICore implementation follows the changed `open_panels` rule is a UICore review matter and was not checked
- The harness static check `shortcut root panel` (open-game-works-core/tools/src/commands/check/static/shortcut-root-panel.ts) is outside this target; it was read but its tests were not run. The rows of test-data/data/tables/shortcut.csv comply with shortcut-core.md:42 (`root_r` is a `Root` row whose `panels` is only the root key)
