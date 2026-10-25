# review CutsceneCore round 1

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

- The commit range 772306a..ea339cf changes no CutsceneCore file. It changes only LocalizationCore (body and heading font weight, the `heading` text style through the theme type variations `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel`, the new settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`) and the settings files. Checked how these reach CutsceneCore:
  - CutsceneCore calls only `LocalizationCore.get_text` (speaker name, client/godot/core/cutscene_core/cutscene_core.gd:1350) and `LocalizationCore.format` (line text with `get_theme_font_size("normal_font_size")` of the text element, cutscene_core.gd:1360; choice text with 0, cutscene_core.gd:1472). The range does not change either operation. A font weight or a `HeadingRichTextLabel` type variation does not change the `normal_font_size` lookup (the variation's base type is `RichTextLabel`)
  - CutsceneCore sets no font, theme or `theme_type_variation` on any element (no match for `theme`/`font` in client/godot/core/cutscene_core/*.gd other than the font size read above). The text style of the view parts is chosen by content code in the game's `cutsceneView` resource, which the cutscene-core spec does not restrict and the localization-core spec leaves to content code
  - `LocalizationCore.init` now also requires the two new integer settings. The CutsceneCore tests start LocalizationCore from `res://generated/core_settings.json` (client/godot/core/cutscene_core/tests/support/cutscene_test_case.gd:146), which holds both keys (client/godot/generated/core_settings.json:474-475), and override no LocalizationCore key. The CutsceneCore tests do not call `LocalizationCore.load_fonts`
- The CutsceneCore tests were not run in this review (`ogw core test` needs the GUT setup, the test host and writes import files in the checkout). Whether they pass at ea339cf is not checked here
- CutsceneCore code that does not interact with LocalizationCore was not read in full: with a commit range, only problems the range causes or reveals are findings, and the range does not reach it
