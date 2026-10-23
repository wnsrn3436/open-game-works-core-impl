extends InputCoreTestCase
## InputCore `init`, `release` and init failures.


func test_init_and_release() -> void:
	assert_true(InputCore.is_initialized())
	var node: Node = InputCore._node
	assert_not_null(node)
	assert_true(node.is_inside_tree())
	assert_false(get_tree().quit_on_go_back, "the platform back button does not end the app")
	InputCore.release()
	assert_false(InputCore.is_initialized())
	assert_false(is_instance_valid(node) and node.is_inside_tree(), "the core node left the tree")
	assert_initial_state()
	assert_true(get_tree().quit_on_go_back, "release puts quit_on_go_back back")
	assert_true(InputCore.init())
	assert_true(InputCore.is_initialized())


func test_second_init_fails() -> void:
	assert_false(InputCore.init())
	assert_eq(errors(), 1)
	assert_true(InputCore.is_initialized())


func test_operations_before_init_fail() -> void:
	InputCore.release()
	assert_false(InputCore.is_pressed(&"jump"))
	assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH)
	assert_eq(InputCore.get_last_gamepad(), -1)
	assert_eq(errors(), 3)
	InputCore.release()


func test_release_restores_the_first_values() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["y"])))
	InputCore.set_pinch_enabled(true)
	key(KEY_H, true)
	touch(0, true, CENTER)
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.PLAY_STATION)
	InputCoreDev.inject_gamepad_connection(1, true)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_RIGHT_X, 0.9), 1)
	assert_true(await DataCore.load(null), "core test data loads")
	assert_true(InputCore.get_prompt(&"jump", InputPrompt.new()))
	assert_true(InputCore._prompt_rows_built, "get_prompt built the prompt table")
	var token: int = block_with([&"jump"], [])
	key(KEY_J, true)
	assert_true(InputCore._last_blocked)
	InputCore.release()
	unblock(token)
	assert_initial_state()
	var buffer: PackedInt32Array = PackedInt32Array([9])
	assert_eq(InputCore.get_connected_gamepads(buffer), 0)
	assert_eq(errors(), 1)
	assert_true(InputCore.init())
	var keys: PackedStringArray = PackedStringArray(["", ""])
	assert_eq(InputCore.get_keys(&"jump", keys), 1)
	assert_eq(keys[0], "J")
	var pads: PackedStringArray = PackedStringArray(["", ""])
	assert_eq(InputCore.get_pad_buttons(&"jump", pads), 1)
	assert_eq(pads[0], "b")
	assert_false(InputCore.is_pressed(&"jump"))
	recorder.clear()
	key(KEY_ESCAPE, true)
	assert_eq(recorder.count("back"), 0, "the back handler is gone")
	touch(1, true, CENTER)
	assert_eq(recorder.count("pointer"), 0, "the pointer observer is gone")
	touch(2, true, CENTER + Vector2(300, 0))
	touch(1, false, CENTER)
	touch(2, false, CENTER + Vector2(300, 0))
	assert_eq(recorder.count("tap"), 2, "pinch is off again")
	assert_eq(recorder.count("pinch"), 0)
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_eq(InputCore.get_prompt_family(), GameData.InputPromptFamily.GENERIC)
	assert_eq(InputCore.get_connected_gamepads(buffer), 0)
	assert_false(InputCore._prompt_rows_built, "the prompt table waits for the next get_prompt")
	assert_eq(InputCore._prompt_rows.size(), 0)
	start_wait_pad_button()
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_RIGHT_X, 0.9), 1)
	assert_eq(pad_result, "right_x+", "the last axis input before release is gone, so the value crosses the threshold")


func test_core_node_destroyed_outside_release() -> void:
	var node: Node = InputCore._node
	node.free()
	assert_false(InputCore.is_initialized())
	assert_initial_state()
	assert_true(InputCore.init())


func test_init_fails_without_a_core_action() -> void:
	InputCore.release()
	InputMap.erase_action(&"cutscene_skip")
	assert_false(InputCore.init())
	assert_eq(errors(), 1)
	assert_false(InputCore.is_initialized())
	assert_initial_state()


func test_init_fails_when_overlapping_actions_share_a_default_input() -> void:
	InputCore.release()
	add_action(&"menu_cancel", [key_event(KEY_K)])
	assert_false(InputCore.init())
	assert_eq(errors(), 1)
	assert_false(InputCore.is_initialized())


func test_init_fails_when_overlapping_actions_share_a_default_pad_input() -> void:
	InputCore.release()
	add_action(&"dash", [pad_axis_event(JOY_AXIS_LEFT_X, 0.8)])
	assert_false(InputCore.init())
	assert_eq(errors(), 1)


func test_actions_of_other_contexts_share_default_inputs() -> void:
	InputCore.release()
	add_action(&"cutscene_log", [key_event(KEY_J)])
	add_action(&"menu_jump", [key_event(KEY_J)])
	assert_true(InputCore.init(), "jump (Gameplay), cutscene_log (Cutscene) and menu_jump (Ui) share J")


func test_init_fails_when_the_pad_axis_wait_threshold_is_out_of_range() -> void:
	for value: float in [0.0, -0.5, 1.5]:
		InputCore.release()
		assert_true(UnitTestCore.set_test_settings("InputCore.padAxisWaitThreshold", value))
		assert_false(InputCore.init(), str(value))
		assert_eq(errors(), 1)
	InputCore.release()
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisWaitThreshold", 1.0))
	assert_true(InputCore.init())


func test_init_fails_when_the_pad_axis_deadzone_is_out_of_range() -> void:
	for value: float in [-0.1, 1.0, 1.5]:
		InputCore.release()
		assert_true(UnitTestCore.set_test_settings("InputCore.padAxisDeadzone", value))
		assert_false(InputCore.init(), str(value))
		assert_eq(errors(), 1)
	for value: float in [0.0, 0.99]:
		InputCore.release()
		assert_true(UnitTestCore.set_test_settings("InputCore.padAxisDeadzone", value))
		assert_true(InputCore.init(), str(value))
		assert_eq(InputCore._pad_axis_deadzone, value)


func test_init_device_is_keyboard_mouse_on_desktop() -> void:
	if CoreBuildInfo.platform == "android" or CoreBuildInfo.platform == "ios":
		assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH)
	else:
		assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)


## Every static var of InputCore is its initial value.
func assert_initial_state() -> void:
	assert_false(InputCore._is_initialized)
	assert_null(InputCore._node)
	assert_null(InputCore._session)
	assert_true(InputCore._quit_on_go_back)
	assert_eq(InputCore._move_threshold, 0.0)
	assert_eq(InputCore._long_press_ms, 0)
	assert_eq(InputCore._swipe_max_ms, 0)
	assert_eq(InputCore._swipe_min_distance, 0.0)
	assert_eq(InputCore._max_judge_pointers, 0)
	assert_eq(InputCore._max_keys_per_action, 0)
	assert_eq(InputCore._max_pad_buttons_per_action, 0)
	assert_eq(InputCore._pad_axis_wait_threshold, 0.0)
	assert_eq(InputCore._pad_axis_deadzone, 0.0)
	assert_eq(InputCore._action_names.size(), 0)
	assert_eq(InputCore._action_index.size(), 0)
	assert_eq(InputCore._back_index, -1)
	assert_eq(InputCore._key_stride, 0)
	assert_eq(InputCore._pad_stride, 0)
	assert_eq(InputCore._source_stride, 0)
	for collection: int in [InputCore._contexts.size(), InputCore._keys.size(), InputCore._key_counts.size(),
			InputCore._pads.size(), InputCore._pad_counts.size(), InputCore._default_keys.size(),
			InputCore._default_key_counts.size(), InputCore._default_pads.size(), InputCore._default_pad_counts.size(),
			InputCore._source_pressed.size(), InputCore._source_strength.size(), InputCore._pressed_counts.size(),
			InputCore._pressed_frames.size(), InputCore._released_frames.size(), InputCore._pointer_used.size(),
			InputCore._pointer_ids.size(), InputCore._pointer_passed.size(), InputCore._pointer_judge.size(),
			InputCore._pointer_moved.size(), InputCore._pointer_long_pressed.size(), InputCore._pointer_dragging.size(),
			InputCore._pointer_press_positions.size(), InputCore._pointer_positions.size(),
			InputCore._pointer_drag_positions.size(), InputCore._pointer_press_times.size(),
			InputCore._pointer_orders.size(), InputCore._connected_gamepads.size(), InputCore._axis_values.size(),
			InputCore._gamepad_families.size(), InputCore._gamepad_slot_ids.size(), InputCore._passed.size(),
			InputCore._prompt_rows.size()]:
		assert_eq(collection, 0, "collections are empty")
	assert_eq(InputCore._press_order, 0)
	assert_false(InputCore._emulated_pressed)
	assert_false(InputCore._emulated_passed)
	assert_false(InputCore._pinch_enabled)
	assert_eq(InputCore._pinch_first, -1)
	assert_eq(InputCore._pinch_second, -1)
	assert_eq(InputCore._pinch_start_distance, 0.0)
	assert_eq(InputCore._pinch_center, Vector2.ZERO)
	assert_eq(InputCore._pinch_scale, 1.0)
	assert_eq(InputCore._device, InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(InputCore._gamepad_family, GameData.InputPromptFamily.GENERIC)
	assert_eq(InputCore._last_gamepad, -1)
	assert_false(InputCore._has_mouse_position)
	assert_eq(InputCore._mouse_position, Vector2.ZERO)
	assert_eq(InputCore._mouse_motion, Vector2.ZERO)
	assert_eq(InputCore._mouse_motion_frame, -1)
	assert_false(InputCore._last_blocked)
	assert_eq(InputCore._cancel_count, 0)
	assert_true(InputCore._back_handler.is_null())
	assert_true(InputCore._pointer_observer.is_null())
	assert_null(InputCore._key_wait)
	assert_null(InputCore._pad_wait)
	assert_false(InputCore._prompt_rows_built)
	assert_null(InputCore._pending_event)
	assert_false(InputCore._pending_focus)
	assert_eq(InputCore._pending_kind, InputCore._OTHER)
	assert_eq(InputCore._pending_slot, -1)
	assert_eq(InputCore._pending_position, Vector2.ZERO)
	assert_eq(InputCore._pending_axis_previous, 0.0)
	assert_eq(InputCore._pending_pad_slot, -1)
	assert_true(InputCore._debug_handler.is_null())
	assert_eq(InputCore.is_initialized(), false)
