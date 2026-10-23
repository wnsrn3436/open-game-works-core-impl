extends "res://core/sound_core/tests/support/sound_test_case.gd"
## Haptic: haptic target, vibration capability, haptic pattern format, segment timing and the DEV haptic log.

const GAMEPAD: int = 0


func after_each() -> void:
	super()
	CoreBuildInfo.platform = CoreBuildInfo.os_platform()


func press_gamepad_button() -> void:
	var press: InputEventJoypadButton = InputEventJoypadButton.new()
	press.device = GAMEPAD
	press.button_index = JOY_BUTTON_A
	press.pressed = true
	InputCoreDev.inject_device_input(press)
	var release: InputEventJoypadButton = InputEventJoypadButton.new()
	release.device = GAMEPAD
	release.button_index = JOY_BUTTON_A
	release.pressed = false
	InputCoreDev.inject_device_input(release)


## The latest haptic log entry.
func last_log() -> HapticLogRecord:
	var buffer: Array[HapticLogRecord] = []
	buffer.resize(SoundCore._haptic_log_count)
	var count: int = SoundCoreDev.get_haptic_log(buffer)
	return buffer[count - 1] if count > 0 else null


func test_disabled_haptic_or_device_target_without_vibration_is_false_without_log() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, scope), "no vibration on the platform")
	assert_eq(last_log().target, SoundCore.HapticTarget.DEVICE)
	assert_false(last_log().played)
	CoreBuildInfo.platform = "android"
	SoundCore.set_haptic_enabled(false)
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, scope), "haptic off")
	SoundCore.set_haptic_enabled(true)
	var token: int = SoundCore.request_pause()
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, scope), "global pause")
	SoundCore.release_pause(token)
	assert_true(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_eq(errors(), 0)


func test_new_play_haptic_stops_the_playing_pattern() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	await load_haptic(HAPTIC_LATE)
	press_gamepad_button()
	assert_true(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.8, 0.0001)
	assert_true(SoundCore.play_haptic(HAPTIC_LATE, scope))
	assert_eq(Input.get_joy_vibration_strength(GAMEPAD), Vector2.ZERO, "the first pattern stopped")
	assert_eq(SoundCore._haptic_segment, 0)


func test_gamepad_input_makes_the_gamepad_the_haptic_target_on_any_platform() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	press_gamepad_button()
	assert_eq(InputCore.get_device(), InputCore.InputDevice.GAMEPAD)
	assert_true(SoundCore.play_haptic(HAPTIC_VALID, scope), "true without Device vibration")
	assert_eq(last_log().target, SoundCore.HapticTarget.GAMEPAD)
	assert_true(last_log().played)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	SoundCore.play_haptic(HAPTIC_VALID, scope)
	assert_eq(last_log().target, SoundCore.HapticTarget.DEVICE)
	assert_eq(errors(), 0)


func test_test_device_gamepad_without_gamepad_input_is_false_without_log() -> void:
	CoreBuildInfo.platform = "android"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_eq(last_log().target, SoundCore.HapticTarget.GAMEPAD)
	assert_eq(errors(), 0)


func test_valid_pattern_plays_on_a_platform_with_vibration_and_is_in_the_haptic_log() -> void:
	CoreBuildInfo.platform = "android"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_true(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_eq(last_log().key, HAPTIC_VALID)
	assert_true(last_log().played)
	assert_eq(last_log().target, SoundCore.HapticTarget.DEVICE)


func test_key_not_loaded_is_false_with_no_sound_core_log() -> void:
	CoreBuildInfo.platform = "android"
	assert_true(await start_modules())
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_eq(errors(), 0)
	assert_eq(errors("ResourceCore"), 1)


func test_resources_out_of_the_pattern_format_are_false_with_one_error_per_key() -> void:
	assert_true(await start_modules())
	var keys: PackedStringArray = [HAPTIC_EMPTY, HAPTIC_ZERO_DURATION, HAPTIC_STRONG, HAPTIC_UNKNOWN_KEY]
	for key: String in keys:
		await load_haptic(key)
	var platforms: PackedStringArray = ["android", "macos"]
	for platform: String in platforms:
		CoreBuildInfo.platform = platform
		for key: String in keys:
			assert_false(SoundCore.play_haptic(key, scope), key + " on " + platform)
	assert_eq(errors(), keys.size())


func test_segments_wait_their_delay_after_the_previous_segment_and_vibrate_for_their_duration() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	press_gamepad_button()
	assert_true(SoundCore.play_haptic(HAPTIC_VALID, scope))
	assert_eq(SoundCore._haptic_segment, 0)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.8, 0.0001)
	await advance(40)
	assert_eq(SoundCore._haptic_segment, 1, "first segment ended")
	await advance(30)
	assert_eq(SoundCore._haptic_segment, 1, "intensity 0 segment")
	await advance(60)
	assert_eq(SoundCore._haptic_segment, 2)
	await advance(10)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 1.0, 0.0001)
	await advance(50)
	assert_null(SoundCore._haptic_pattern, "pattern ended")


func test_haptic_log_keeps_the_latest_requests_and_logs_an_error_when_the_buffer_is_full() -> void:
	set_int("SoundCore.devHapticLogCount", 3)
	CoreBuildInfo.platform = "android"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	await load_haptic(HAPTIC_LATE)
	var keys: PackedStringArray = [HAPTIC_VALID, HAPTIC_LATE, HAPTIC_VALID, HAPTIC_LATE, HAPTIC_LATE]
	for key: String in keys:
		SoundCore.play_haptic(key, scope)
	var buffer: Array[HapticLogRecord] = []
	buffer.resize(5)
	assert_eq(SoundCoreDev.get_haptic_log(buffer), 3)
	assert_eq(buffer[0].key, HAPTIC_VALID)
	assert_eq(buffer[1].key, HAPTIC_LATE)
	assert_eq(buffer[2].key, HAPTIC_LATE)
	var small: Array[HapticLogRecord] = [HapticLogRecord.new()]
	assert_eq(SoundCoreDev.get_haptic_log(small), 1)
	assert_eq(small[0].key, HAPTIC_LATE)
	assert_eq(errors(), 1)


func test_segments_shorter_than_a_frame_vibrate_for_their_whole_duration_and_none_is_skipped() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_SHORT)
	press_gamepad_button()
	assert_true(SoundCore.play_haptic(HAPTIC_SHORT, scope))
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 1.0, 0.0001)
	assert_almost_eq(Input.get_joy_vibration_duration(GAMEPAD), 0.01, 0.0001)
	# Frames 17 ms apart, as at 60 fps: the second segment is due at 35 ms, between the frames at 34 and 51 ms.
	await advance(17)
	await advance(17)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 1.0, 0.0001, "second segment not due yet")
	await advance(17)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.5, 0.0001, "the late frame plays the segment")
	assert_almost_eq(Input.get_joy_vibration_duration(GAMEPAD), 0.01, 0.0001, "for its whole duration")
	await advance(17)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.3, 0.0001, "delay 0 after the vibration ended")
	assert_almost_eq(Input.get_joy_vibration_duration(GAMEPAD), 0.01, 0.0001)
	await advance(17)
	assert_null(SoundCore._haptic_pattern, "pattern ended")


func test_a_frame_late_by_several_segments_skips_none_of_them() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_SHORT)
	press_gamepad_button()
	assert_true(SoundCore.play_haptic(HAPTIC_SHORT, scope))
	await advance(500)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.5, 0.0001, "the next segment after the hitch")
	assert_almost_eq(Input.get_joy_vibration_duration(GAMEPAD), 0.01, 0.0001)
	assert_eq(SoundCore._haptic_segment, 1)
	await advance(10)
	assert_almost_eq(Input.get_joy_vibration_strength(GAMEPAD).x, 0.3, 0.0001)
	await advance(10)
	assert_null(SoundCore._haptic_pattern, "pattern ended")


func test_play_haptic_with_a_missing_or_released_scope_is_false_with_an_error() -> void:
	CoreBuildInfo.platform = "android"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VALID)
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, null))
	assert_eq(errors(), 1, "missing scope")
	var released: Scope = ResourceCore.create_scope(ResourceCore.ScopeKind.PANEL, "sound_test_released")
	ResourceCore.release_scope(released)
	assert_false(SoundCore.play_haptic(HAPTIC_VALID, released))
	assert_eq(errors(), 1, "released scope")
	assert_eq(errors("ResourceCore"), 0)
	var buffer: Array[HapticLogRecord] = []
	buffer.resize(SoundCore._haptic_log_count)
	assert_eq(SoundCoreDev.get_haptic_log(buffer), 0, "no haptic log")
	assert_null(SoundCore._haptic_pattern, "no vibration")


func test_play_haptic_of_a_key_with_variants_plays_a_variant_other_than_the_last() -> void:
	CoreBuildInfo.platform = "macos"
	assert_true(await start_modules())
	await load_haptic(HAPTIC_VARIANT)
	press_gamepad_button()
	var last: float = -1.0
	for index: int in 6:
		assert_true(SoundCore.play_haptic(HAPTIC_VARIANT, scope), "a loaded key with variants plays")
		assert_true(last_log().played)
		var strength: float = Input.get_joy_vibration_strength(GAMEPAD).x
		assert_true(is_equal_approx(strength, 0.2) or is_equal_approx(strength, 0.6), "first segment of a variant")
		assert_false(is_equal_approx(strength, last), "two plays in a row have different variants")
		last = strength
	assert_eq(errors(), 0)
