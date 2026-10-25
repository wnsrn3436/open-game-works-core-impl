# update core: BootstrapCore review debt D1

## done

- `BootstrapCore` (client core, godot): the fatal screen `Label` now has its own font, `ThemeDB.fallback_font`, set with `add_theme_font_override("font", ...)` (client/godot/core/bootstrap_core/bootstrap_core.gd:1124). An own override comes before the theme `default_font` that `LocalizationCore.load_fonts` sets to the game font chain. So the fatal screen text draws with the engine font, at its default weight, in every boot stage, before and after `LoadData` 4, on both the `Fatal` UI layer and the canvas layer used before `UICore` init
- Why `ThemeDB.fallback_font` is not a game resource: the engine sets it from project setting `gui/theme/custom_font` when that setting has a value, and otherwise uses its built-in font. Only the harness tool writes `project.godot`. Content can add engine settings only through `client/boot/project_settings.cfg`, and the allowed prefixes do not include `gui/theme/` (client-content engines/godot.md). No core module changes `ThemeDB.fallback_font`
- Core tests in client/godot/core/bootstrap_core/tests/test_boot_fatal.gd:
  - `test_fatal_screen_after_load_fonts_before_ui_ready_draws_without_the_game_font_chain`: `icon/pad_b` is removed from the resource key list, and a fatal is reported on the `load_prompt_icons` error log during `LoadData`, which is after `load_fonts` and before UI ready. With `LocalizationCore.bodyFontWeight` 400, the test asserts that the theme default font is the `FontVariation` chain, and that the fatal screen text font is not that chain and is `ThemeDB.fallback_font`
  - `test_fatal_screen_after_ui_ready_draws_without_the_game_font_chain`: after `BootCompletedEvent`, the hidden callback of a system popup closed by `UICore.close_all_popups` reports a fatal. The fatal popup cannot be opened during `close_all_popups`, so the fatal screen is shown. The test makes the same font assertions
  - Both tests fail on the old code: with the override line removed, each one reports that the label font is the same `FontVariation` as the chain and is not the `FontFile` fallback. Both pass with the fix

## spec proposals

none

## review

- D1 (`records/review-debt/BootstrapCore.json`): fixed. Fix at client/godot/core/bootstrap_core/bootstrap_core.gd:1124. Tests added: the two tests above

## unverified

- The last `ogw core test godot BootstrapCore QACore UnitTestCore` desktop run (non-web) exited 1. BootstrapCore and UnitTestCore passed, but the QACore render pass was skipped with "render pass not run: the macOS screen is locked or the display sleeps". It was retried once and gave the same result. QACore was not changed. The `--web` run of the same three modules passed and is the last run in the run log. The lead agent needs to rerun the desktop target with the screen unlocked
- `ThemeDB.fallback_font` is the engine built-in font only while `gui/theme/custom_font` stays out of `project.godot`. The current tool rules guarantee this. No core test checks it
