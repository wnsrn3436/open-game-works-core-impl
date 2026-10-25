# NoticeCore review round 1

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

- The commit range `772306a..f69aac2` changes no NoticeCore file (`client/godot/core/notice_core/`, `core-spec/NoticeCore.json`). It changes only `LocalizationCore` (body and heading font weight, the `HeadingLabel`, `HeadingButton`, `HeadingRichTextLabel` theme type variations, the settings `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`) and review records of other modules. Checked how the change reaches NoticeCore: NoticeCore calls only `LocalizationCore.get_language_code` (`client/godot/core/notice_core/notice_core.gd:361`), which the range does not change; it does not call `load_fonts`; no module outside `localization_core` refers to the heading type variations; the new settings keys have defaults in `client/godot/generated/core_settings.json:474`, so `LocalizationCore.init` in `client/godot/core/notice_core/tests/support/notice_test_case.gd:244` still reads them without the NoticeCore test setting them
- The NoticeCore core tests were not run in this review (no Godot run was made); the conclusion above comes from reading the code
- NoticeCore code outside the range was read only in `client/godot/core/notice_core/notice_core.gd` to see how it uses `LocalizationCore`; `notice_core_node.gd`, `http_image_downloader.gd`, `web_image_downloader.gd`, `notice_waiter.gd`, `dev/` and the tests were not checked for problems that existed before the range
