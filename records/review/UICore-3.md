# review UICore round 3

## findings

none

## previous

none

## out of scope

none

## debt

| id | result | finding | evidence |
|---|---|---|---|
| D1 | withdrawn | none | The UICore defining document settles which dim counts. In `open-game-works-core/skills/client-core/modules/ui-core.md:132`, a dim is the one placed directly below a visible panel or popup with dim on, with one dim on the `Popup` layer. `:133` defines dimmed as "a visible dim is drawn above the UI element", and in that document "dim" always means this panel or popup dim: the UI property dim at `:129`, `UICore.dimResource` and `UICore.dimOpacity` at `:395-396`, the `Panel` and `Popup` rows of the layer table at `:108,113`, and the `## test` items at `:472,480,517`. The layer table names what the `Tutorial` layer holds as "screen highlight and hand pointer display" owned by `TutorialCore` (`:114`), not as a dim. `tutorial-core.md:75` uses "a dim that covers the outside of the anchor rectangle" only to describe that highlight, and it leaves the anchor element itself undarkened, so it is not a dim placed below a panel or popup. UICore also cannot depend on `TutorialCore`: `ui-core.md:21` does not list it, while `tutorial-core.md:21` depends on UICore. The code matches the spec. `_is_dimmed` (client/godot/core/ui_core/ui_core.gd:2469-2478) checks only `_popup_dim` on `Popup` and `_panel_dim` on `Panel`, and `test_layers_above_the_dim` (client/godot/core/ui_core/tests/test_dimmed.gd:63-67) asserts that a `Tutorial` layer element is not dimmed. The commit range is empty, and input `## spec changes` is `none`. What remains of the reported effect, the UI quality contrast check measuring text under a shown tutorial highlight (`open-game-works-core/tools/src/commands/check/lib/ui-quality.ts:216`), is in the harness check, which is outside this target |

## must fix

none

## unknown

- The commit range 7f9917a..7f9917a is empty and input `## spec changes` is `none`, so no code changed. Only the code and tests at the position of D1 were read again (ui_core.gd:770-775,2469-2478, tests/test_dimmed.gd:63-67, tutorial_core.gd:1137-1142)
- No tests were run. Withdrawing D1 rests on the defining documents and on reading `_is_dimmed`. `ogw review run` runs the UICore suite and the core tests of the modules that depend on UICore
- Whether the harness UI quality check (`open-game-works-core/tools/src/commands/check/lib/ui-quality.ts`) should skip text under a shown tutorial highlight was not judged, because it is outside this target
