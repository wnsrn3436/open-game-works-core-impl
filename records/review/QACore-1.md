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

- Render pass of QACore: not run. `ogw core test godot QACore` ended with `QACore skipped` (`render pass not run: the macOS screen is locked or the display sleeps`). The job summary is 128 tests, 128 passed, and `client/godot/core/qa_core/tests/` holds 128 `test_` functions, 8 of them in `test_render_capture.gd`. Those 8 are not checked as drawn on a screen. That file does not touch the settings the range changed
- `test_init_does_not_read_the_settings_that_only_ogw_check_uses` (`client/godot/core/qa_core/tests/test_lifecycle.gd:47`): it passed in the job above, but it was not run on code with the removed checks restored. By reading, a restored check fails `QACore.init` for the string values the test sets (`_is_array_setting` is `false` for `AccessibilityCore.textScales` and `supportedLanguages`, `CoreSettings.has_bool` is `false` for `gamepadSupported`). The fourth removed check, `uiCheckScreens`, is not in that test, because the key is no longer in `client/godot/generated/core_settings_types.json`. By reading, a restored check of it fails `QACore.init` in every QACore test, because `client/godot/generated/core_settings.json` no longer has that key. This was also not run
- QACore code and tests outside the range changes: not read in full. The range changes QACore only in `_read_settings`, its constants and helper, one test, and the settings list of `core-spec/QACore.json`. For that part, no reference to the removed constants or `_is_array_setting` remains under `client/godot/`, nothing under `client/godot/core/qa_core/` or `client/godot/core/bootstrap_core/dev/` reads the removed keys, and the `## settings` keys, `source` and `owner` of `qa-core.md` equal `core-spec/QACore.json`
- Other range changes that a QACore call could reach: `LocalizationCore.list_languages` and `MessageCore.show_black_box` have no call under `client/godot/core/qa_core/` or `client/godot/core/bootstrap_core/dev/`. Other callers are not checked here; they belong to the reviews of those modules
- Tests of other modules: not run. No finding needed them. The readers of `uiCheckScreens`, `uiQuality` and the other removed keys in the harness tool (`tools/src/commands/check/lib/loop.ts`) were read only to see that they take these keys from game settings. Those tools are outside this target and were not run
