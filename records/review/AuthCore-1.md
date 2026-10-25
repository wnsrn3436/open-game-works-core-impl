# review AuthCore round 1

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

- The commit range 772306a..ea339cf changes only LocalizationCore (`client/godot/core/localization_core/localization_core.gd`, its tests and resources), the settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight` (`settings/core-settings.json`, `settings/core-settings.schema.json`, `client/godot/generated/core_settings*.json`, `core-spec/LocalizationCore.json`) and the run records. No AuthCore file changed. Checked where AuthCore meets the changed code: AuthCore calls only `LocalizationCore.bind_text` (`client/godot/core/auth_core/auth_popup_util.gd:28`) and `LocalizationCore.get_text` (`client/godot/core/auth_core/adapters/google_desktop_sign_in.gd:86`), neither of which changed. AuthCore never calls `load_fonts` and never uses the heading type variations (`HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel`). The AuthCore spec says nothing about font weight or text style
- AuthCore tests (`client/godot/core/auth_core/tests/support/auth_test_env.gd:84`) call `LocalizationCore.init`, which now also requires the two new integer settings in `_read_settings`. AuthCore tests read them from `client/godot/generated/core_settings.json:474-475`, where both are 0. With weight 0 and no `load_fonts`, `_apply_fonts` and `_restore_heading_types` never run (`_heading_chain` stays null in `_clean_up`), so AuthCore tests reach no new LocalizationCore path. This comes from reading the code: the AuthCore tests were not run, because they run through `ogw core test` with its test host, and a review agent does not start that
- The rest of AuthCore was not reviewed, because the range did not touch it. Neither were the new LocalizationCore code and its tests, which belong to LocalizationCore's own review
