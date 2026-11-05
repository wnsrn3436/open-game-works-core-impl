# review SoundCore round 1

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

- The commit range `51d323b..ce539a3` changes no file under `client/godot/core/sound_core/`, `core-spec/SoundCore.json`, the reserved sound data or generated accessors, and no SoundCore settings key in `settings/core-settings.schema.json` or `client/godot/generated/core_settings_types.json` (the changes there are server keys and a reordering of `InputCore.maxKeysPerAction`/`InputCore.maxPadButtonsPerAction` and `storage.userLockWaitMs`). Of the modules SoundCore depends on (`UtilCore`, `LogCore`, `EventCore`, `TimeCore`, `LocalDataCore`, `ResourceCore`, `InputCore`), only `client/godot/core/input_core/` changed: one doc comment line of `_on_emulated_mouse` in `input_core.gd` and InputCore's own tests. `InputCore.get_device`, `InputCore.get_last_gamepad`, `InputCoreDev.inject_device_input` and `InputCoreDev.set_test_device`, which `sound_core.gd:449-451` and `tests/test_haptic.gd` use, did not change
- Changed callers of SoundCore in the range (`client/godot/core/accessibility_core/`, `client/godot/core/cutscene_core/`, `client/godot/core/qa_core/`) were checked only for changed uses of SoundCore operations: the diff adds or removes no call of `play_bgm`, `play_haptic`, `request_pause`, `get_playing`, `get_haptic_log`, `inject_focus_change` or `SoundPlayedEvent`; the added test lines only call `SoundCore.play`/`stop`/`is_playing` with the behavior the spec states
- `client/godot/core/unit_test_core/dev/unit_test_core.gd` changed `require_platform` to return whether the test goes on and `_record` to record a skipped test that also failed as `fail`. The SoundCore callers (`tests/test_limiter.gd:31`, `tests/test_limiter.gd:60`, `tests/test_page_audio_suspended.gd:102`) return right after the call through their own platform check, with no assert before it; `before_each` of `tests/support/sound_test_case.gd:40` only asserts `set_test_settings` results and `SoundPageAudio.unhook` (`tests/support/sound_page_audio.gd:47`) does nothing outside the browser, so a skipped SoundCore test does not become `fail`. The guards still compare the platform list instead of using the new return value; that is not a defect of behavior
- `client/godot/core/sound_core/sound_core.gd` was read whole for problems that existed before the range; none of `critical`, `high` or `medium` with confidence 80 or more was found. Haptic behavior on real devices (`Input.vibrate_handheld`, `Input.start_joy_vibration`) and the limiter output on native platforms and in the browser runtime were not run
- The SoundCore core tests were not run in this review: no finding needed a run, and `ogw review run` runs the core tests of the dependents after each fix
