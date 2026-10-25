# review QACore round 1

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

- The commit range changes no QACore file. It changes `LocalizationCore` (body and heading font weight, the `heading` text style as the theme type variations `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel`) and adds the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`. The QACore code reached by these changes was checked: `list_ui` `font_size` and `clipped` in `client/godot/core/qa_core/dev/qa_query.gd:307` and `client/godot/core/qa_core/dev/qa_query.gd:315` read the font through `Control.get_theme_font`, which resolves the element's `theme_type_variation`, so a `heading` element is measured with the heading chain it draws with, as `client-core/engines/godot.md` QACore `clipped` sets. `set_language` (`client/godot/core/qa_core/dev/qa_builtins.gd:794`) and the `language` state (`client/godot/core/qa_core/dev/qa_query.gd:93`) use no changed operation. The QACore test start (`client/godot/core/qa_core/tests/support/qa_test_case.gd:139`) calls `LocalizationCore.init` with the settings that hold the new keys with default 0 (`settings/core-settings.json`) and does not call `load_fonts`
- The Godot core tests were not run. Whether the engine applies `variation_opentype` of a `FontVariation` in `Font.get_string_size`, so that `clipped` of a `heading` element with a weight greater than 0 measures the weighted width, was checked only from the engine API, not by a run
