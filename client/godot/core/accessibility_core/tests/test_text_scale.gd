extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Text scale: `set_text_scale` and the DEV `set_test_text_scale`.

const KEY_TEXT_SCALE: String = "AccessibilityCore.text_scale"


func test_set_text_scale_sets_the_localization_text_scale() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_true(AccessibilityCore.set_text_scale(1250))
	assert_eq(LocalizationCore.get_text_scale(), 1250)
	assert_eq(AccessibilityCore.get_settings().text_scale_permille, 1250)


func test_set_text_scale_outside_the_list_is_false_with_an_error_and_keeps_the_text_scale() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_true(AccessibilityCore.set_text_scale(1250))
	assert_false(AccessibilityCore.set_text_scale(1100))
	assert_eq(errors(), 1)
	assert_eq(LocalizationCore.get_text_scale(), 1250)
	assert_eq(AccessibilityCore.get_settings().text_scale_permille, 1250)
	assert_eq(LocalDataCore.get_value_int(DEVICE, KEY_TEXT_SCALE, 0), 1250)


func test_set_test_text_scale_applies_the_text_scale_and_leaves_the_device_file() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	AccessibilityCoreDev.set_test_text_scale(1500)
	assert_eq(LocalizationCore.get_text_scale(), 1500)
	assert_eq(LocalDataCore.get_value_int(DEVICE, KEY_TEXT_SCALE, -1), -1, "nothing saved")
	assert_eq(AccessibilityCore.get_settings().text_scale_permille, 1000, "the option value stays")
	AccessibilityCoreDev.set_test_text_scale(2000)
	assert_eq(LocalizationCore.get_text_scale(), 2000, "a value outside textScales is a test value too")
	assert_eq(LocalDataCore.get_value_int(DEVICE, KEY_TEXT_SCALE, -1), -1, "nothing saved")
	assert_eq(errors(), 0)


func test_set_test_text_scale_below_1000_logs_an_error_and_keeps_the_text_scale() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	AccessibilityCoreDev.set_test_text_scale(999)
	assert_eq(errors(), 1)
	assert_eq(LocalizationCore.get_text_scale(), 1000)


func test_subtitle_shown_after_set_test_text_scale_has_the_scaled_font_size() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	AccessibilityCoreDev.set_test_text_scale(1500)
	AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	assert_true(subtitle_visible())
	assert_eq(subtitle_font_size(), floori(SUBTITLE_FONT_SIZE * 1500 / 1000.0))


func test_subtitle_on_screen_takes_the_font_size_of_set_test_text_scale() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	assert_eq(subtitle_font_size(), SUBTITLE_FONT_SIZE)
	AccessibilityCoreDev.set_test_text_scale(1500)
	assert_true(subtitle_visible())
	assert_eq(subtitle_font_size(), floori(SUBTITLE_FONT_SIZE * 1500 / 1000.0))
