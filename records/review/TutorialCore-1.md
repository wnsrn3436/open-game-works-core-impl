# review TutorialCore round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/ui_core/ui_core.gd:2374: medium `UICore.is_dimmed`, added in this range, looks only at the panel dim and the popup dim, so text under the dim of a shown tutorial step gives `dimmed` `false`, and the UI quality contrast check (`open-game-works-core/tools/src/commands/check/lib/ui-quality.ts:215`) still measures that text in the darkened capture. Run path: a `<feature>.open_<screen>` command opens a screen while a tutorial step with `anchor` is `Shown`; `TutorialCore._present` makes `view.dim` visible on the `Tutorial` layer (`client/godot/core/tutorial_core/tutorial_core.gd:1139`); the UI quality check has no tutorial handling. Calculated example with the test view dim `Color(0, 0, 0, 0.5)`, `minContrast` 3, and sRGB text 0.9 on background 0.4: 4.58:1 without the dim and 2.66:1 under it, a `low contrast` failure on text the tutorial dims on purpose. The defining documents do not settle whether this dim counts: `open-game-works-core/skills/client-core/modules/ui-core.md:131` defines only the panel and popup dim, while `:132` says "a visible dim" in UI layer order and `open-game-works-core/skills/client-core/modules/tutorial-core.md:75` calls the highlight a dim. Not reproduced in a game run. The cause is in UICore and the check, which is outside this target

## debt

none

## must fix

none

## unknown

- The commit range changes no file under `client/godot/core/tutorial_core/` or `server/core/tutorial/`, and not `core-spec/TutorialCore.json`, `core-spec/tutorial.json`, `test-data/` or `tools/data-tool/` (`git diff --quiet` of those paths is clean). `## spec changes` is `none`
- Changed code that TutorialCore reaches, checked: the only behavior code added to `client/godot/core/ui_core/ui_core.gd` is `is_dimmed`, `_is_dimmed` and `_dim_above`. Its only removed lines are two section comments. TutorialCore does not call these functions, and the `UICore` operations it calls (`client/godot/core/tutorial_core/tutorial_core.gd`) did not change. The `uiQuality.maxFlatShare` key removed from `client/godot/generated/core_settings.json` is not read by TutorialCore
- `client/godot/core/tutorial_core/tutorial_core.gd`, `tutorial_core_node.gd`, `tutorial_run.gd` and `tutorial_block_wait.gd` were read against `tutorial-core.md`, and no defect was found outside the range. This read was not a full review of the module: the test files, `tutorial_def.gd`, `tutorial_step_def.gd`, `tutorial_view.gd`, `server/core/tutorial/` and the anchor and pointer behavior inside `UICore` and `InputCore` were not read
- Tests were not run by this review. `records/1793645028102-update-core-mvzlxt6u5be5ef.md` reports the core tests of the UICore dependents as passing in the browser run, and `records/1793645028102-update-core-mvzlxt6u5be5ef-runs.json` lists TutorialCore in that command. That result was not checked again here
- The contrast calculation in `## out of scope` was made from the formula in `open-game-works-core/skills/client-core/modules/qa-core.md:151`, not from a capture. Whether a real game has a tutorial shown during UI quality captures was not checked
