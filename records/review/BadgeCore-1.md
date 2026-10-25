# BadgeCore review round 1

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

- The commit range `772306a..ea339cf` changes no BadgeCore code or test (`git diff --stat` touches only `client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`, the core settings files and the generated settings). Checked the places where BadgeCore reaches the changed code: `client/godot/core/badge_core/badge_core.gd:333` calls only `LocalizationCore.format`, which the range does not change; the count `Label` made in `client/godot/core/badge_core/badge_core.gd:357` sets no theme type variation, so it stays in the `body` text style and takes the default font, as `localization-core` `### font` sets; `client/godot/core/badge_core/tests/support/badge_test_case.gd:62` calls `LocalizationCore.init`, whose new required integer settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` are in `client/godot/generated/core_settings.json:474`, which `client/godot/core/core_settings.gd:8` reads, and `load_fonts` is not called by the BadgeCore tests
- The BadgeCore core tests were not run in this review: the run needs the GUT setup, the test host and the core fixtures that `ogw core test` prepares. Whether they pass on `ea339cf` is not checked here
