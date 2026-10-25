# BootstrapCore review round 1

## findings

none

## previous

none

## out of scope

- client/godot/core/bootstrap_core/bootstrap_core.gd:1123: medium The fatal screen `Label` has no font or theme of its own, so it draws with `default_font` of the theme that `LocalizationCore.load_fonts` set to the language font chain loaded through `ResourceCore` (client/godot/core/localization_core/localization_core.gd:135-136). The BootstrapCore spec says the fatal screen is drawn "without data, translation or game resources" (bootstrap-core.md `### fatal error`). Run path: a boot passes `LoadData` 4 (`load_fonts`), then reaches the fatal screen, either because a module emits `FatalErrorRequestedEvent` during `load_prompt_icons` (before UI ready) or because the fatal popup cannot be opened after UI ready (`_show_fatal_screen` at bootstrap_core.gd:1022/1071). The fatal screen text is then drawn with the game font chain, and with `LocalizationCore.bodyFontWeight` when it is greater than 0. A fatal does not release `LocalizationCore`, so the chain stays applied while the screen is shown. The chain was applied as `default_font` before this range too, so the range did not introduce this

## debt

none

## must fix

none

## unknown

- The range changes only `LocalizationCore` (font weights, `heading` text style), core settings and `core-spec/LocalizationCore.json`; no BootstrapCore file changed. I checked the BootstrapCore call sites (`_load_data`: `load_fonts` result ignored, session check after the await; restart, shutdown and exit reverse release calling `LocalizationCore.release`) against the new `load_fonts` and `_clean_up` code. I found no change in BootstrapCore behavior: with the default weights 0 the default font has the same structure as before, the new warn logs do not affect the boot order, `load_fonts` returns `false` on a session change after `release`, and `release` puts back the heading types before the next boot's `load_fonts`
- I did not run any core tests. That BootstrapCore tests pass with this change comes from the core agent's run log (records/1792899335100-update-core-mvn9z0scb9678f-runs.json: `ogw core test godot` over the 26 dependents including BootstrapCore, 1880 of 1880 passed). The render pass of `AccessibilityCore`, `NativeUiCore` and `QACore` was skipped there
- BootstrapCore has no test that boots with `LocalizationCore.bodyFontWeight` or `LocalizationCore.headingFontWeight` greater than 0, or that restarts after `load_fonts` with heading types already in a project theme. The BootstrapCore spec does not require one, so I do not report it as a finding. I did not check that path in a run
- I did not review how `LocalizationCore` picks the theme and resolves the theme type variation for a project theme without `default_font`. That is the `LocalizationCore` review target, not this one
