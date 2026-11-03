# review: LocalizationCore round 2

## findings

none

## previous

| id | result | evidence |
|---|---|---|
| R1-1 | fixed | `client/godot/core/localization_core/tests/test_font_weight.gd:230` now asserts on a new `_label(&"ScoreLabel")` made after the second `init`. That label has no override from the first `init`, and `_on_node_added` (`client/godot/core/localization_core/localization_core.gd:759`) reads its first size from the theme. How the defect was restored, in two temporary copies of commit 8c50a6d outside the target checkout: `_clean_up` was changed so that after `_restore_heading_types()` it clears `font_size` of every theme type whose type variation base is a heading type, so the style in the theme has no size left after `release`. Copy 1 keeps the new assert: `ogw core test godot LocalizationCore --file client/godot/core/localization_core/tests/test_font_weight.gd` fails `test_a_style_the_theme_bases_on_a_heading_type_draws_with_the_heading_font_after_a_restart` with `[16] expected to equal [76]`, and no other test or engine error is reported. Copy 2 has the same change with the round 1 assert `label.get_theme_font_size("font_size")` put back: the same run passes, which is the defect R1-1 named. |

## out of scope

none

## debt

none

## must fix

none

## unknown

- Run in this review: `ogw core test godot LocalizationCore` and `ogw core test godot LocalizationCore --web` pass on the target commit. Both results were reused from a passing result of the same key, not run again.
- The two mutated runs were native, not in the browser run, because `--file` is not used with `--web`.
- The modules of `ogw core dependents LocalizationCore` were not run here. The commit range changes no implementation file, only one assert of a test of the target; the report of the core agent says they pass.
- The commit range changes only that assert and files under `records/`, so the implementation was read only along the path of that assert (`_on_node_added`, `_clean_up`, `_restore_heading_types`). The items of `## unknown` of round 1 that were not run (a project theme without `default_font` whose styles are based on heading types, `pong` with this change) were not run here either.
