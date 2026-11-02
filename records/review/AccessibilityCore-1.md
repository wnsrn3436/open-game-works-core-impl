# review: AccessibilityCore round 1

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

- The commit range does not change `client/godot/core/accessibility_core/`. The changes in the range that reach AccessibilityCore are the new read-only `UICore.is_dimmed` and `_is_dimmed` / `_dim_above` (`client/godot/core/ui_core/ui_core.gd:750`, `client/godot/core/ui_core/ui_core.gd:2374`), and the `dimmed` field of QACore `list_ui` (`client/godot/core/qa_core/dev/qa_query.gd:271`), which also lists the elements of AccessibilityCore. Checked: AccessibilityCore does not call `is_dimmed`, and the operation changes no state that AccessibilityCore reads (`UICore.get_layer`). The subtitle box is a direct child of the `Message` layer and the color filter is a direct child of the `LoadingIcon` layer, and both layers are above `Panel` and `Popup` in `UILayer` (`client/godot/core/ui_core/ui_core.gd:6`), so `_dim_above` gives `false` for both. This equals the dimmed definition of `UICore` (`open-game-works-core/skills/client-core/modules/ui-core.md:132`)
- The other changes in the range do not reach AccessibilityCore: test resources and test support of UICore and QACore, `core-spec/UICore.json` (the new `is_dimmed` entry), review debt lists and run logs. `client/godot/generated/core_settings.json` only loses `maxFlatShare`, a key outside `AccessibilityCore.*` that no file under `client/`, `settings/`, `tools/`, `core-spec/` or the harness skills uses
- The code of `client/godot/core/accessibility_core/` was read against `## API`, `## behavior`, `## error` and `## DEV` of its spec for problems that existed before the range. None was found with evidence. This was not a check of every aspect over the whole target, because the commit range limits this round to the changes
- `ogw core test godot AccessibilityCore` on this checkout (job `mvzmd01a2230ba`) ended with exit code 1 and module result `skipped`. The run log has 40 of 40 tests passed. The native render pass was not run, with the reason `render pass not run: the macOS screen is locked or the display sleeps`. So the three tests of `client/godot/core/accessibility_core/tests/test_render_color_filter.gd` were not run on this checkout (the earlier run in `records/review/AccessibilityCore-1-runs.json` with 43 of 43 was on an earlier commit). The range changes neither the filter code nor the layer order those tests use
- The browser run (`--web`) was not run
