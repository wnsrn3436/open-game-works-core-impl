# review ScreenEffectCore round 1

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

- The commit range 772306a..aa67c84 changes no file under `client/godot/core/screen_effect_core/` and no file of its dependency modules (`log_core`, `event_core`, `tween_core`, `resolution_core`, `ui_core`); `git log` on those folders shows only the initial commit. The changes are LocalizationCore body and heading font weight (`client/godot/core/localization_core/localization_core.gd`), the settings keys `LocalizationCore.bodyFontWeight` and `LocalizationCore.headingFontWeight`, and review records of other modules
- The only places where these changes reach ScreenEffectCore are its test setup `client/godot/core/screen_effect_core/tests/support/screen_effect_test_case.gd:36-57`, which calls `LocalizationCore.init`, `resolve_language` and `load_translation`, and `UICore.prepare`. `LocalizationCore._read_settings` now requires both new integer keys, and both are in `settings/core-settings.json` and `client/godot/generated/core_settings.json`. `load_fonts`, where the font chain and the heading type variations changed, is called only by `client/godot/core/bootstrap_core/bootstrap_core.gd:397`, not by UICore or the ScreenEffectCore tests. The overlays are solid-color rectangles and draw no text, so the font changes do not change their behavior
- The ScreenEffectCore core tests were not run in this review; that the tests pass after the range was checked by reading only
- Code of ScreenEffectCore outside the range was not reviewed, because a review with a commit range writes only the problems that the changes of that range cause or reveal
