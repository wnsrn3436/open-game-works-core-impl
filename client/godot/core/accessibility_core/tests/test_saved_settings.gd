extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Saving and applying: the default without saved values, saved values after release and init, and saved values out
## of their allowed values.

const KEY_TEXT_SCALE: String = "AccessibilityCore.text_scale"
const KEY_COLOR_MODE: String = "AccessibilityCore.color_mode"
const KEY_SUBTITLES: String = "AccessibilityCore.subtitles"
const KEY_REDUCE_SHAKE: String = "AccessibilityCore.reduce_shake"
const KEY_REDUCE_FLASH: String = "AccessibilityCore.reduce_flash"


func test_without_saved_values_get_settings_is_the_default() -> void:
	assert_true(await start_modules())
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "after init")
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "after apply_saved_settings")
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	assert_false(AccessibilityCore._filter.visible)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_default_subtitles_is_subtitles_default() -> void:
	set_bool("AccessibilityCore.subtitlesDefault", false)
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, false, false, false)


func test_set_values_come_back_after_release_init_and_apply_saved_settings() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_true(AccessibilityCore.set_text_scale(1500))
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	AccessibilityCore.set_subtitles(false)
	AccessibilityCore.set_reduce_shake(true)
	AccessibilityCore.set_reduce_flash(true)
	assert_settings(AccessibilityCore.get_settings(), 1500, DEUTERANOPIA, false, true, true, "after set")
	assert_eq(LocalDataCore.get_value_int(DEVICE, KEY_TEXT_SCALE, 0), 1500)
	assert_eq(LocalDataCore.get_value_string(DEVICE, KEY_COLOR_MODE, ""), "Deuteranopia")
	assert_false(LocalDataCore.get_value_bool(DEVICE, KEY_SUBTITLES, true))
	assert_true(LocalDataCore.get_value_bool(DEVICE, KEY_REDUCE_SHAKE, false))
	assert_true(LocalDataCore.get_value_bool(DEVICE, KEY_REDUCE_FLASH, false))
	AccessibilityCore.release()
	assert_true(AccessibilityCore.init())
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "before apply_saved_settings")
	assert_false(AccessibilityCore._filter.visible, "nothing applied before apply_saved_settings")
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1500, DEUTERANOPIA, false, true, true, "after apply")
	assert_eq(LocalizationCore.get_text_scale(), 1500)
	assert_true(AccessibilityCore._filter.visible)


func test_get_settings_returns_a_copy() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var settings: AccessibilitySettings = AccessibilityCore.get_settings()
	settings.text_scale_permille = 1500
	settings.reduce_flash = true
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false)


func test_saved_values_out_of_their_allowed_values_are_the_default_without_a_log() -> void:
	assert_true(await start_modules(false))
	LocalDataCore.set_value_int(DEVICE, KEY_TEXT_SCALE, 1100)
	LocalDataCore.set_value_string(DEVICE, KEY_COLOR_MODE, "deuteranopia")
	LocalDataCore.set_value_bool(DEVICE, KEY_SUBTITLES, false)
	LocalDataCore.set_value_bool(DEVICE, KEY_REDUCE_FLASH, true)
	assert_true(AccessibilityCore.init())
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, false, false, true)
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_saved_values_of_another_type_are_the_default_without_an_accessibility_log() -> void:
	assert_true(await start_modules(false))
	LocalDataCore.set_value_string(DEVICE, KEY_TEXT_SCALE, "1500")
	LocalDataCore.set_value_int(DEVICE, KEY_COLOR_MODE, 2)
	LocalDataCore.set_value_int(DEVICE, KEY_REDUCE_SHAKE, 1)
	assert_true(AccessibilityCore.init())
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false)
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)
