# review: AccessibilityCore round 1

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

- The commit range does not change `client/godot/core/accessibility_core/`, `core-spec/AccessibilityCore.json` or any `AccessibilityCore.*` entry of `settings/core-settings.schema.json`. None of the modules in `## dependency` (`LogCore`, `EventCore`, `LocalDataCore`, `LocalizationCore`, `ResourceCore`, `SoundCore`, `SafeAreaCore`, `UICore`, `CameraCore`, `ScreenEffectCore`) changes in the range either. So I checked only the changed code that calls AccessibilityCore
- Commit ad967246 makes the DEV `shutdown` of `BootstrapCore` call `release` of modules that are not initialized too (`client/godot/core/bootstrap_core/bootstrap_core.gd:1350`). It also drops `UnitTestCore._clear_pre_init_values`. When AccessibilityCore is not initialized, `AccessibilityCore.release` (`client/godot/core/accessibility_core/accessibility_core.gd:125-128`) only empties `_test_rendering_method`, the one value a core test sets before `init`, and then returns. It calls no other module, leaves no log and ends no operation. That is what `## lifecycle` of `skills/core/SKILL.md` (line 73) and step 3 of `shutdown` in `skills/client-core/modules/bootstrap-core.md:235` ask for. `AccessibilityCoreDev.set_test_text_scale` needs AccessibilityCore to be initialized, so it sets no value before `init`. The tests that set `_test_rendering_method` (`client/godot/core/accessibility_core/tests/test_color_filter.gd:88-118`) set it and read it inside one test, so the release in `shutdown` between tests does not change what they check
- Commit ad967246 also changes `QACore.release` (`client/godot/core/qa_core/dev/qa_core.gd:231-236`) for a module that is not initialized. That path touches only the QACore test launch values and does not reach the `set_text_scale` command (`client/godot/core/qa_core/dev/qa_builtins.gd:272-273`), which calls `AccessibilityCoreDev.set_test_text_scale`
- I did not run the core tests in this review, because no finding needed a run to check it. I did not check the changes of other modules in the range: they belong to their own reviews
