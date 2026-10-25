# SceneCore review round 1

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

- The commit range 772306afd2a3678f69ab999ae6f134c0fd11c0cc..7325b62a4eec24e130fd6ee6a52ceb982073abf4 changes no SceneCore code, test or spec (`client/godot/core/scene_core/` and `core-spec/SceneCore.json` have no diff). It changes only LocalizationCore (`client/godot/core/localization_core/`, `core-spec/LocalizationCore.json`), the core settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`) and agent run records. LocalizationCore is not in `## dependency` of the SceneCore spec, and SceneCore source does not refer to it
- The only place in SceneCore that reaches the changed code is the test setup `client/godot/core/scene_core/tests/support/scene_case.gd:112`, `:121`, `:122` (`LocalizationCore.init`, `resolve_language`, `load_translation`). The change on that path is that `LocalizationCore.init` (`client/godot/core/localization_core/localization_core.gd:366`) now also requires the two new integer settings; both have the default 0 in `settings/core-settings.json` and `client/godot/generated/core_settings.json:474`, so the setup still passes them. The SceneCore tests do not call `LocalizationCore.load_fonts`, so they do not reach the new `_apply_fonts`, `_weighted_chain` and `_restore_heading_types` paths. I read this path but did not run the SceneCore tests to check it
- SceneCore code and tests outside that test setup were not reviewed: the range does not change them and the changes do not reach them, so problems they already had are outside this review. LocalizationCore itself is outside the review target and was not reviewed
