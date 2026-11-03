# review: CutsceneCore round 1

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

- The commit range changes no file of `client/godot/core/cutscene_core/`. Its only code changes are `_restore_heading_types` of `client/godot/core/localization_core/localization_core.gd:714` and tests in `client/godot/core/localization_core/tests/test_font_weight.gd`. So this round read the paths of CutsceneCore that touch `LocalizationCore` (`client/godot/core/cutscene_core/cutscene_core.gd:1350`, `:1360`, `:1472`, which call `get_text` and `format` and read `normal_font_size`) and the start of `client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd`. The rest of `cutscene_core.gd` and of the cutscene tests was not read, and the aspects were not checked on it.
- No path from CutsceneCore to the changed code was found. `_restore_heading_types` is called only from the clean-up of `LocalizationCore` (`client/godot/core/localization_core/localization_core.gd:854`), and only when `_heading_chain` is set. A search of `client/godot/core/cutscene_core/` finds no `load_fonts`, `theme_type_variation` or heading type, so the cutscene tests never run the changed code.
- Not run: a cutscene view whose text elements use a heading type or a style based on one, across `release`, another `init` and another `load_fonts`. No core test covers this and the test view does not use those styles. From reading the code, the change clears only the base type and font item of the heading types and does not touch the font size that `client/godot/core/cutscene_core/cutscene_core.gd:1360` reads, so no finding is written. This was not checked by a run.
- A theme loaded from a `.tres` and `pong` were not run here. These are the items the `LocalizationCore` reports left open, and this round did not settle them.
- `ogw core test godot CutsceneCore` and `ogw core test godot CutsceneCore --web` pass on the target commit. Both results were reused from a passing result of the same key, not run again.
- No code was changed or mutated in this round, because there was no finding and no `## previous` row to check.
