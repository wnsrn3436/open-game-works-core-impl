# review: UICore round 1

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

- The commit range `f3ac5b0..e2afcde` changes only `client/godot/core/localization_core/localization_core.gd`, `client/godot/core/localization_core/tests/test_font_weight.gd` and `records/`. It changes no file of `client/godot/core/ui_core/`, `client/godot/core/bootstrap_core/`, `core-spec/` or `settings/`. The input has `## spec changes` `none` and no `## debt` or `## must fix` item, so there is no UICore change for a finding to come from. This round is not a review of the whole target: a whole review needs commit range `none`
- The links from the target to the changed code were judged by reading the code. The changed function `_restore_heading_types` (`client/godot/core/localization_core/localization_core.gd:714`) only changes the heading types of the font theme, and only `_clean_up` calls it, when `load_fonts` applied a heading font. `client/godot/core/ui_core/` calls only `LocalizationCore.format` and `LocalizationCore.get_text` (`client/godot/core/ui_core/ui_core.gd:1808`, `:1810`, `:1813`), and does not name a heading type, `theme_type_variation`, a `Theme` or a theme font. `client/godot/core/ui_core/tests/support/ui_test_case.gd:166` calls `LocalizationCore.init()`, and the UICore tests do not call `load_fonts`, so they do not reach the changed function
- Not checked by a run: a system popup or panel prefab of content code whose text element uses a heading type or a style based on one, across a restart. Neither the core tests of the target nor this review run that path. The test `test_a_style_the_theme_bases_on_a_heading_type_draws_with_the_heading_font_after_a_restart` in `client/godot/core/localization_core/tests/test_font_weight.gd` covers it for elements outside UICore
- The release order of UICore and `LocalizationCore` while UICore elements are alive was not traced in `BootstrapCore`. `core-spec/UICore.json` lists `LocalizationCore` as a dependency, but the order in the module list was not read
- Run in this review: `ogw core test godot UICore` passes on the target commit, and the result was reused from a passing result of the same key, not run again. `ogw core test godot UICore --web` was not run
- Not read: the rest of `client/godot/core/ui_core/ui_core.gd`, `client/godot/core/ui_core/ui_scroll_list.gd`, the other files of `client/godot/core/ui_core/` and its tests, apart from the searches above. The spec of UICore was read, and the implementation was not compared with it, so `## out of scope` says nothing about the implementation outside the range. The debt list `records/review-debt/UICore.json` (`D1`) was not given in the input and was not judged
