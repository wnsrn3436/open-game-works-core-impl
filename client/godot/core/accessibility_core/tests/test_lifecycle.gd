extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Lifecycle: init check, release, init again, destruction of the core node outside release, operations before init
## and core settings out of their range.


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(false))
	assert_false(AccessibilityCore.is_initialized())
	assert_true(AccessibilityCore.init())
	assert_true(AccessibilityCore.is_initialized())
	AccessibilityCore.release()
	assert_false(AccessibilityCore.is_initialized())


func test_release_removes_the_filter_and_the_subtitle_box_and_puts_every_static_var_back() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	var filter: ColorRect = AccessibilityCore._filter
	var box: ColorRect = AccessibilityCore._subtitle_box
	var node: Node = AccessibilityCore._node
	assert_true(filter.visible, "the filter is on screen")
	assert_true(box.visible, "the subtitle is on screen")
	assert_true(node.is_inside_tree())
	AccessibilityCore.release()
	assert_false(is_instance_valid(filter), "the color filter was destroyed")
	assert_false(is_instance_valid(box), "the subtitle box was destroyed")
	assert_false(node.is_inside_tree())
	assert_false(AccessibilityCore._is_initialized)
	assert_null(AccessibilityCore._node)
	assert_eq(AccessibilityCore._text_scales.size(), 0)
	assert_false(AccessibilityCore._subtitles_default)
	assert_false(AccessibilityCore._filter_enabled)
	assert_eq(AccessibilityCore._matrices.size(), 0)
	assert_eq(AccessibilityCore._reduced_shake_permille, 0)
	assert_eq(AccessibilityCore._reduced_flash_max_opacity, 0.0)
	assert_eq(AccessibilityCore._subtitle_width_permille, 0)
	assert_eq(AccessibilityCore._subtitle_box_opacity, 0.0)
	assert_eq(AccessibilityCore._subtitle_font_size, 0)
	assert_eq(AccessibilityCore._subtitle_padding, 0.0)
	assert_eq(AccessibilityCore._subtitle_bottom_margin, 0.0)
	assert_null(AccessibilityCore._settings)
	assert_null(AccessibilityCore._filter)
	assert_null(AccessibilityCore._filter_material)
	assert_null(AccessibilityCore._subtitle_box)
	assert_null(AccessibilityCore._subtitle_label)
	assert_eq(AccessibilityCore._subtitle_handle, SoundCore.INVALID_HANDLE)
	assert_true(AccessibilityCore.init())
	assert_false(AccessibilityCore._filter.visible, "a new filter is hidden until the saved values are applied")
	AccessibilityCore.apply_saved_settings()
	assert_eq(AccessibilityCore.get_settings().color_mode, DEUTERANOPIA, "release keeps the saved values")
	assert_true(AccessibilityCore._filter.visible)


func test_core_node_destroyed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await start_modules())
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	var filter: ColorRect = AccessibilityCore._filter
	var box: ColorRect = AccessibilityCore._subtitle_box
	var node: Node = AccessibilityCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(AccessibilityCore.is_initialized())
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(filter), "the color filter was destroyed")
	assert_false(is_instance_valid(box), "the subtitle box was destroyed")
	assert_true(AccessibilityCore.init(), "init again after the app exit clean up")


func test_operations_before_init_log_an_error_and_return_their_failure_values() -> void:
	assert_true(await start_modules(false))
	await load_voice(VOICE_LOOP)
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "before init")
	assert_false(AccessibilityCore.set_text_scale(1250))
	assert_false(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	AccessibilityCore.set_subtitles(false)
	AccessibilityCore.set_reduce_shake(true)
	AccessibilityCore.set_reduce_flash(true)
	assert_eq(AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key()), SoundCore.INVALID_HANDLE)
	AccessibilityCoreDev.set_test_text_scale(1500)
	assert_eq(errors(), 9)
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	assert_eq(LocalDataCore.get_value_int(DEVICE, "AccessibilityCore.text_scale", -1), -1, "nothing saved")
	assert_true(AccessibilityCore.init())
	assert_false(AccessibilityCore.init())
	assert_eq(errors(), 1)


func test_init_fails_with_an_error_for_core_settings_out_of_their_range() -> void:
	assert_true(await start_modules(false))
	var no_1000: PackedInt64Array = [1250, 1500]
	_assert_int_array_fails("AccessibilityCore.textScales", no_1000, TEXT_SCALES)
	var below_1: PackedInt64Array = [1000, 0]
	_assert_int_array_fails("AccessibilityCore.textScales", below_1, TEXT_SCALES)
	var repeated: PackedInt64Array = [1000, 1250, 1250]
	_assert_int_array_fails("AccessibilityCore.textScales", repeated, TEXT_SCALES)
	var eight: PackedFloat64Array = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
	set_matrices(eight)
	_assert_init_fails("a matrix of 8 numbers")
	set_matrices(DEUTERANOPIA_MATRIX)
	var missing: Dictionary[String, PackedFloat64Array] = {
		"Protanopia": IDENTITY_MATRIX,
		"Deuteranopia": IDENTITY_MATRIX,
	}
	assert_true(UnitTestCore.set_test_settings("AccessibilityCore.colorMatrices", missing))
	_assert_init_fails("no Tritanopia matrix")
	set_matrices(DEUTERANOPIA_MATRIX)
	_assert_int_fails("AccessibilityCore.reducedShakePermille", 1001, REDUCED_SHAKE_PERMILLE)
	_assert_int_fails("AccessibilityCore.reducedShakePermille", -1, REDUCED_SHAKE_PERMILLE)
	_assert_int_fails("AccessibilityCore.subtitleWidthPermille", 0, SUBTITLE_WIDTH_PERMILLE)
	_assert_int_fails("AccessibilityCore.subtitleWidthPermille", 1001, SUBTITLE_WIDTH_PERMILLE)
	_assert_float_fails("AccessibilityCore.reducedFlashMaxOpacity", 1.5, REDUCED_FLASH_MAX_OPACITY)
	_assert_float_fails("AccessibilityCore.subtitleBoxOpacity", -0.1, 0.5)
	_assert_int_fails("AccessibilityCore.subtitleFontSize", 0, SUBTITLE_FONT_SIZE)
	_assert_float_fails("AccessibilityCore.subtitlePadding", -1.0, SUBTITLE_PADDING)
	_assert_float_fails("AccessibilityCore.subtitleBottomMargin", -1.0, SUBTITLE_BOTTOM_MARGIN)
	assert_true(AccessibilityCore.init(), "init with the settings back in range")


func _assert_init_fails(text: String) -> void:
	assert_false(AccessibilityCore.init(), "init fails: " + text)
	assert_false(AccessibilityCore.is_initialized())
	assert_eq(errors(), 1, "one error: " + text)


func _assert_int_array_fails(key: String, value: PackedInt64Array, valid: PackedInt64Array) -> void:
	set_int_array(key, value)
	_assert_init_fails("%s %s" % [key, value])
	set_int_array(key, valid)


func _assert_int_fails(key: String, value: int, valid: int) -> void:
	set_int(key, value)
	_assert_init_fails("%s %d" % [key, value])
	set_int(key, valid)


func _assert_float_fails(key: String, value: float, valid: float) -> void:
	set_float(key, value)
	_assert_init_fails("%s %s" % [key, value])
	set_float(key, valid)
