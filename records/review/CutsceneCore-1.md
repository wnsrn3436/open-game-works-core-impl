# review CutsceneCore round 1

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

- The commit range d4c3ae7f..0ebf2f23 changes no CutsceneCore file (`client/godot/core/cutscene_core/`), no `core-spec/CutsceneCore.json` and no `tools/data-tool/src/checks/CutsceneCore.ts`. Of the modules in `## dependency` of the spec (`open-game-works-core/skills/client-core/modules/cutscene-core.md:21`), it changes only UICore. The changes outside `records/` reach CutsceneCore as below:
  - The new read-only `UICore.is_dimmed`, `_is_dimmed` and `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`, `client/godot/core/ui_core/ui_core.gd:2379`). CutsceneCore does not call them, and they change no state that CutsceneCore reads. The `Cutscene` layer is above `Panel` and below `Popup` (`client/godot/core/ui_core/ui_core.gd:6`), and the cutscene root is under `UICore.get_layer(Cutscene)` (`client/godot/core/cutscene_core/cutscene_core.gd:171`). So by reading the code, a cutscene element gets `false` under the panel dim and `true` under a visible popup dim, including the dim of a pause popup opened with `open_system_popup` when that popup has dim on (`client/godot/core/cutscene_core/cutscene_core.gd:1736`, `client/godot/core/ui_core/ui_core.gd:1754`). This equals the dimmed definition of UICore (`open-game-works-core/skills/client-core/modules/ui-core.md:132`). No test runs `is_dimmed` on a cutscene element
  - The `dimmed` field of QACore `list_ui` (`client/godot/core/qa_core/dev/qa_query.gd:271`) also lists the cutscene view elements while a cutscene plays. CutsceneCore code does not refer to QACore
  - Test resources and test support of UICore and QACore, and the new `is_dimmed` entry of `core-spec/UICore.json`: CutsceneCore code and tests do not use them
  - `client/godot/generated/core_settings.json` only loses `maxFlatShare`. It is not a `CutsceneCore.*` key, not `cutsceneView` and not `TweenCore.maxDurationMs`, and no file under `client/godot/`, `settings/`, `core-spec/` or `tools/data-tool/src/` uses it
- The code of `client/godot/core/cutscene_core/` was not checked against every aspect of its spec, because the commit range limits this round to the changes and `## spec changes` is `none`
- `ogw core test godot CutsceneCore` on this checkout (job `mvzmh79gf71a69`) ended with exit code 0 and 134 of 134 tests passed. The browser run (`--web`) was not run
