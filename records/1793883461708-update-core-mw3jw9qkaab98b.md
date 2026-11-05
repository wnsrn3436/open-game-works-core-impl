# update core: LocalizationCore

## done

- `LocalizationCore` (Godot) aligned with the spec changes 2e8185b..HEAD of `localization-core.md` and the LocalizationCore rows of `godot.md`. Commit 177c4a6
  - DEV `set_test_timezone_offset`: new `LocalizationCoreDev.set_test_timezone_offset(offset_ms: int)` (`client/godot/core/localization_core/dev/localization_core_dev.gd`). An offset outside -86399999..86399999 leaves one error log and keeps the offset in use. Like `set_test_device_language`, it works before `init`. `release` clears it also when the module is not initialized (`localization_core.gd` `release`)
  - `bind_text` / `unbind_text` of a missing element (`null`) and of a `Control` that is not a UI text element each leave one error log and change no binding. The two cases now have separate log messages (`_check_text_element`). Rebinding a bound element with another key and unbinding an element that is not bound already worked as the new spec says; only the doc comments changed
  - UI text element = `Label`, `RichTextLabel`, `Button`, `LineEdit`, `TextEdit` (new `godot.md` wording): the code already matched (`_is_text_element`)
- Core tests
  - `test_format.gd`: the fixture and the 9-hour test set the offset with `set_test_timezone_offset` and no longer write private fields. New test `test_timezone_offset_outside_one_day_is_an_error_and_leaves_the_offset_in_use` checks ±86400000 (error log, `date`/`datetime` result unchanged) and that the range ends ±86399999 are accepted
  - `test_text_binding.gd`: new tests for rebinding with another key (also after `load_translation` success), for `unbind_text` of an unbound element (no log, text kept, other bindings kept), and for `bind_text`/`unbind_text` of `null` (one error log each, binding unchanged). Existing tests now also check that the non-text-element `unbind_text` keeps the existing binding, and that a `Control` holding a `Label` is not a UI text element
  - `test_lifecycle.gd`: `release` resets the offset that `set_test_timezone_offset` set
- No code debt list `records/review-debt/LocalizationCore.json` exists, so there were no debt items to fix
- `core-spec/LocalizationCore.json` is unchanged (DEV operations are not in the core spec file)
- No engine-specific implementation rules document was written; `## <engine> build` of `tools/ogw.md` was not written
- Last runs: `ogw core test godot` and `ogw core test godot --web` over LocalizationCore and all modules from `ogw core dependents LocalizationCore` (26 client modules): all pass. `ogw code check core`: type check, lint, dependency, secret all pass

## spec proposals

none

## review

none

## unverified

- The parameter type of `bind_text` and `unbind_text` stays `Control`. A non-`Control` object (e.g. a `Node2D`) is refused by the GDScript type check at compile time, or with an engine script error for an untyped caller, and does not reach the module's error log. `godot.md` does not set the parameter type. Only `null` and `Control`s that are not UI text elements are tested
- In the first full `--web` run, which ran at the same time as the full headless run, `GameUpdateCore` `test_format_check.gd::test_each_format_check_item_fails_alone` failed: it reached its 30000 ms test time limit, and the cleanup after that logged `find_children` on null. A solo `--web` run of `GameUpdateCore` and a later solo full `--web` run of all 26 modules both passed. My reading is that the test timed out under the load of two suites running together. I did not change it and did not check further whether the test is close to its time limit when run alone
- The test run regenerated `client/godot/dev/generated/data/game_data_dev.gd` with two IDs (`[iap_unsold]`, `[iap_vip_google_only]`) that come from test data unrelated to this change. I discarded that change and did not commit it
