# MessageCore review round 1

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

- The commit range changes no MessageCore code or test. Its only code change in a MessageCore dependency is LocalizationCore font weight and the `heading` text style (`client/godot/core/localization_core/localization_core.gd`, the settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`). The MessageCore side of that change was checked: the labels that MessageCore makes by code (`client/godot/core/message_core/message_core.gd:578`) set no font and no `theme_type_variation`, so they draw in the `body` text style with the default font. LocalizationCore spec says an element whose text style was not set is `body`. `MessageView.text_label` is a `Label` (`client/godot/core/message_core/message_view.gd:7`), and a `Label` can take the `HeadingLabel` variation, so a prefab can still choose `heading`. MessageCore calls only `get_text` and `format` (`message_core.gd:176`, `message_core.gd:178`), and the range did not change either one. The MessageCore tests do not call `LocalizationCore.load_fonts` (`client/godot/core/message_core/tests/support/message_test_case.gd:71`). The new integer settings that `LocalizationCore.init` reads have defaults in `settings/core-settings.json` and `client/godot/generated/core_settings.json`, so `init` still succeeds in `start_modules`
- The Godot core tests were not run in this review; the code was only read
- Because there is a commit range, the parts of MessageCore that the range does not reach were not audited in full. I read `message_core.gd` and the test support while checking the interaction above, and I found no problem of severity `medium` or higher there. This does not mean those parts passed
