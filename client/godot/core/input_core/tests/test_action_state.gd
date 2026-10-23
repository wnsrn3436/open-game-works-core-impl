extends InputCoreTestCase
## Action state, `get_vector`, back handling and `inject_action`.


func test_pressed_frames() -> void:
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"jump"))
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"jump"))
	assert_true(InputCore.is_pressed(&"jump"))
	assert_false(InputCore.is_just_released(&"jump"))
	await next_frame()
	assert_false(InputCore.is_just_pressed(&"jump"))
	assert_true(InputCore.is_pressed(&"jump"))
	key(KEY_J, false)
	assert_false(InputCore.is_pressed(&"jump"))
	await input_frame()
	assert_true(InputCore.is_just_released(&"jump"))
	assert_false(InputCore.is_pressed(&"jump"))
	await next_frame()
	assert_false(InputCore.is_just_released(&"jump"))


func test_device_input_counts_for_the_first_process_frame_after_it() -> void:
	var reader: InputCoreTestContentReader = keep(InputCoreTestContentReader.new()) as InputCoreTestContentReader
	reader.action = &"jump"
	get_tree().root.add_child(reader)
	var presses: Array[Callable] = [key.bind(KEY_J, true), pad_button.bind(JOY_BUTTON_B, true)]
	var releases: Array[Callable] = [key.bind(KEY_J, false), pad_button.bind(JOY_BUTTON_B, false)]
	for i: int in presses.size():
		# after the content code of a frame, as an input of the automation channel
		var frame: int = await _run_late(reader, presses[i])
		assert_eq(reader.read(frame), _state(false, false, false), "the frame of the press")
		assert_eq(reader.read(frame + 1), _state(true, true, false), "the first process frame after the press")
		assert_eq(reader.read(frame + 2), _state(true, false, false), "the next process frame")
		frame = await _run_late(reader, releases[i])
		assert_eq(reader.read(frame), _state(true, false, false), "the frame of the release")
		assert_eq(reader.read(frame + 1), _state(false, false, true), "the first process frame after the release")
		assert_eq(reader.read(frame + 2), _state(false, false, false), "the next process frame")
	# from the frame signal, before the process callbacks of the frame
	await next_frame()
	var start: int = Engine.get_process_frames()
	key(KEY_J, true)
	await _wait_reads(reader, start + 1)
	assert_eq(reader.read(start), _state(true, true, false), "the first process frame after the press")
	assert_eq(reader.read(start + 1), _state(true, false, false), "the next process frame")
	await next_frame()
	start = Engine.get_process_frames()
	key(KEY_J, false)
	await _wait_reads(reader, start + 1)
	assert_eq(reader.read(start), _state(false, false, true), "the first process frame after the release")
	assert_eq(reader.read(start + 1), _state(false, false, false), "the next process frame")


func test_device_press_canceled_before_its_frame_counts_in_the_frame_of_the_cancel() -> void:
	await next_frame()
	key(KEY_J, true)
	InputCore.cancel_input()
	await input_frame()
	assert_false(InputCore.is_pressed(&"jump"))
	assert_true(InputCore.is_just_pressed(&"jump"), "the press counts in the frame of its release")
	assert_true(InputCore.is_just_released(&"jump"))
	await next_frame()
	assert_false(InputCore.is_just_pressed(&"jump"), "the canceled press does not count again")
	assert_false(InputCore.is_just_released(&"jump"))


func test_device_press_before_its_frame_counts_in_the_frame_of_an_inject_press_of_the_action() -> void:
	var reader: InputCoreTestContentReader = keep(InputCoreTestContentReader.new()) as InputCoreTestContentReader
	reader.action = &"jump"
	get_tree().root.add_child(reader)
	# the inject is a second pressed source: the count of pressed sources goes from 1 to 2
	var frame: int = await _run_late(reader, _press_key_then_inject)
	assert_eq(reader.read(frame + 1), _state(true, false, false), "the press counted in the frame of the inject")
	assert_eq(reader.read(frame + 2), _state(true, false, false))


func test_device_release_before_its_frame_counts_in_the_frame_of_an_inject_press_of_the_action() -> void:
	var reader: InputCoreTestContentReader = keep(InputCoreTestContentReader.new()) as InputCoreTestContentReader
	reader.action = &"jump"
	get_tree().root.add_child(reader)
	key(KEY_J, true)
	await next_frame()
	# the key release takes the count of pressed sources from 1 to 0 and the inject press from 0 to 1
	var frame: int = await _run_late(reader, _release_key_then_inject)
	assert_eq(reader.read(frame + 1), _state(true, false, false),
		"the release and the press counted in the frame of the inject")
	assert_eq(reader.read(frame + 2), _state(true, false, false))


func test_device_press_before_its_frame_counts_in_the_frame_of_a_gamepad_disconnection() -> void:
	var reader: InputCoreTestContentReader = keep(InputCoreTestContentReader.new()) as InputCoreTestContentReader
	reader.action = &"jump"
	get_tree().root.add_child(reader)
	InputCoreDev.inject_gamepad_connection(0, true)
	# the disconnection releases one of two pressed sources: the count of pressed sources goes from 2 to 1
	var frame: int = await _run_late(reader, _press_key_and_pad_button_then_disconnect)
	assert_eq(reader.read(frame + 1), _state(true, false, false),
		"the press counted in the frame of the disconnection")
	assert_eq(reader.read(frame + 2), _state(true, false, false))


func test_key_repeat_does_not_change_the_action_state() -> void:
	key(KEY_J, true)
	await input_frame()
	await next_frame()
	key(KEY_J, true, true)
	assert_false(InputCore.is_just_pressed(&"jump"))
	assert_true(InputCore.is_pressed(&"jump"))


func test_two_sources_and_one_released() -> void:
	key(KEY_D, true)
	pad_axis(JOY_AXIS_LEFT_X, 0.6)
	assert_almost_eq(InputCore.get_strength(&"move_right"), 1.0, 0.0001)
	key(KEY_D, false)
	assert_true(InputCore.is_pressed(&"move_right"))
	assert_almost_eq(InputCore.get_strength(&"move_right"), 0.6, 0.0001)
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	assert_false(InputCore.is_pressed(&"move_right"))
	assert_eq(InputCore.get_strength(&"move_right"), 0.0)


func test_inject_matches_device_input() -> void:
	pad_axis(JOY_AXIS_LEFT_X, 0.4)
	await input_frame()
	var device_input: Array[bool] = [InputCore.is_pressed(&"move_right"), InputCore.is_just_pressed(&"move_right")]
	var device_strength: float = InputCore.get_strength(&"move_right")
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	await input_frame()
	var device_release: Array[bool] = [InputCore.is_pressed(&"move_right"), InputCore.is_just_released(&"move_right")]
	await next_frame()
	InputCore.inject_action(&"move_right", true, 0.4)
	assert_eq([InputCore.is_pressed(&"move_right"), InputCore.is_just_pressed(&"move_right")], device_input)
	assert_almost_eq(InputCore.get_strength(&"move_right"), device_strength, 0.0001)
	InputCore.inject_action(&"move_right", false, 0.0)
	assert_eq([InputCore.is_pressed(&"move_right"), InputCore.is_just_released(&"move_right")], device_release)
	assert_eq(device_input, [true, true])
	assert_eq(device_release, [false, true])


func test_axis_direction_below_the_deadzone_is_strength_0() -> void:
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE - 0.05)
	assert_false(InputCore.is_pressed(&"move_right"))
	assert_eq(InputCore.get_strength(&"move_right"), 0.0)
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"move_right"))
	assert_almost_eq(InputCore.get_strength(&"move_right"), PAD_AXIS_DEADZONE, 0.0001, "the size is not rescaled")
	pad_axis(JOY_AXIS_LEFT_X, PAD_AXIS_DEADZONE - 0.05)
	assert_false(InputCore.is_pressed(&"move_right"), "a size below the deadzone releases the direction")
	await input_frame()
	assert_true(InputCore.is_just_released(&"move_right"))
	pad_axis(JOY_AXIS_LEFT_X, 0.5)
	pad_axis(JOY_AXIS_LEFT_Y, -(PAD_AXIS_DEADZONE - 0.05))
	assert_almost_eq(InputCore.get_vector(&"move_left", &"move_right", &"move_up", &"move_down"),
		Vector2(0.5, 0.0), Vector2(0.0001, 0.0001))
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	pad_axis(JOY_AXIS_LEFT_Y, 0.0)


func test_back_axis_direction_below_the_deadzone_does_not_call_the_back_handler() -> void:
	assert_true(InputCore.set_pad_buttons(&"back", PackedStringArray(["right_x+"])))
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	pad_axis(JOY_AXIS_RIGHT_X, PAD_AXIS_DEADZONE - 0.05)
	assert_eq(recorder.count("back"), 0)
	pad_axis(JOY_AXIS_RIGHT_X, PAD_AXIS_DEADZONE + 0.1)
	assert_eq(recorder.count("back"), 1)
	pad_axis(JOY_AXIS_RIGHT_X, 0.0)


func test_back_axis_direction_press_and_strength_change() -> void:
	assert_true(InputCore.set_pad_buttons(&"back", PackedStringArray(["left_y-"])))
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	# PAD_AXIS_DEADZONE < a < b < c <= 1
	for value: float in [-0.3, -0.5, -0.9, 0.0, -0.3]:
		pad_axis(JOY_AXIS_LEFT_Y, value)
	assert_eq(recorder.count("back"), 2, "a strength change of a pressed direction is no back input")
	pad_axis(JOY_AXIS_LEFT_Y, 0.0)


func test_axis_value_crossing_zero_releases_one_direction_and_presses_the_other() -> void:
	# move_down has left_y+ and move_up has left_y-
	pad_axis(JOY_AXIS_LEFT_Y, 0.5)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"move_down"))
	await next_frame()
	pad_axis(JOY_AXIS_LEFT_Y, -0.5)
	await input_frame()
	assert_true(InputCore.is_just_released(&"move_down"), "the one input releases the positive direction")
	assert_true(InputCore.is_just_pressed(&"move_up"), "and presses the negative direction in the same frame")
	assert_false(InputCore.is_pressed(&"move_down"))
	assert_almost_eq(InputCore.get_strength(&"move_up"), 0.5, 0.0001)
	pad_axis(JOY_AXIS_LEFT_Y, 0.0)


func test_get_vector() -> void:
	pad_axis(JOY_AXIS_LEFT_X, 0.5)
	pad_axis(JOY_AXIS_LEFT_Y, -0.25)
	assert_almost_eq(InputCore.get_vector(&"move_left", &"move_right", &"move_up", &"move_down"),
		Vector2(0.5, -0.25), Vector2(0.0001, 0.0001))
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	pad_axis(JOY_AXIS_LEFT_Y, 0.0)
	key(KEY_D, true)
	key(KEY_S, true)
	var vector: Vector2 = InputCore.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
	assert_almost_eq(vector.length(), 1.0, 0.0001)
	assert_almost_eq(vector, Vector2(1.0, 1.0).normalized(), Vector2(0.0001, 0.0001))
	key(KEY_A, true)
	assert_almost_eq(InputCore.get_vector(&"move_left", &"move_right", &"move_up", &"move_down"),
		Vector2(0.0, 1.0), Vector2(0.0001, 0.0001))


func test_back_callback_once_per_back_input() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	key(KEY_ESCAPE, true)
	assert_eq(recorder.count("back"), 1)
	key(KEY_ESCAPE, true, true)
	key(KEY_ESCAPE, false)
	assert_eq(recorder.count("back"), 1, "no callback for a key repeat and a release")
	InputCore._node.notification(Node.NOTIFICATION_WM_GO_BACK_REQUEST)
	assert_eq(recorder.count("back"), 2, "platform back button")
	assert_true(InputCore.is_initialized(), "the platform back button does not end the app")
	InputCore.inject_action(&"back", true, 1.0)
	assert_eq(recorder.count("back"), 3)
	InputCore.inject_action(&"back", false, 0.0)
	assert_eq(recorder.count("back"), 3)


func test_back_input_without_a_callback_is_dropped_without_a_log() -> void:
	key(KEY_ESCAPE, true)
	key(KEY_ESCAPE, false)
	InputCore.inject_action(&"back", true, 1.0)
	assert_eq(recorder.count("back"), 0)


func test_back_shares_a_pad_button_with_a_gameplay_action() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	pad_button(JOY_BUTTON_B, true)
	assert_eq(recorder.count("back"), 1)
	assert_false(InputCore.is_pressed(&"jump"), "the consumed back input does not press jump")
	pad_button(JOY_BUTTON_B, false)
	await next_frame()
	recorder.back_result = false
	pad_button(JOY_BUTTON_B, true)
	assert_eq(recorder.count("back"), 2)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"jump"))
	pad_button(JOY_BUTTON_B, false)
	assert_true(restart_input_core())
	await next_frame()
	pad_button(JOY_BUTTON_B, true)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"jump"))
	assert_eq(recorder.count("back"), 2)


func test_core_action_pad_buttons() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	pad_button(JOY_BUTTON_B, true)
	assert_eq(recorder.count("back"), 1)
	pad_button(JOY_BUTTON_A, true)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	pad_button(JOY_BUTTON_START, true)
	assert_true(InputCore.is_pressed(&"cutscene_skip"))


func test_core_action_keys() -> void:
	key(KEY_SPACE, true)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	key(KEY_SPACE, false)
	key(KEY_ENTER, true)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	key(KEY_TAB, true)
	assert_true(InputCore.is_pressed(&"cutscene_skip"))


func test_inject_strength_out_of_range_is_clamped() -> void:
	InputCore.inject_action(&"fire", true, 1.5)
	assert_eq(errors(), 1)
	assert_eq(InputCore.get_strength(&"fire"), 1.0)
	InputCore.inject_action(&"move_left", true, -0.5)
	assert_eq(errors(), 1)
	assert_true(InputCore.is_pressed(&"move_left"))
	assert_eq(InputCore.get_strength(&"move_left"), 0.0)


func test_inject_press_with_nan_strength_is_not_injected() -> void:
	InputCore.inject_action(&"fire", true, NAN)
	assert_eq(errors(), 1)
	assert_false(InputCore.is_pressed(&"fire"))


func test_action_state_operations_on_back_fail() -> void:
	assert_false(InputCore.is_pressed(&"back"))
	assert_false(InputCore.is_just_pressed(&"back"))
	assert_false(InputCore.is_just_released(&"back"))
	assert_eq(InputCore.get_strength(&"back"), 0.0)
	assert_eq(InputCore.get_vector(&"back", &"move_right", &"move_up", &"move_down"), Vector2.ZERO)
	assert_eq(errors(), 5)


func test_has_action() -> void:
	assert_true(InputCore.has_action(&"jump"))
	assert_true(InputCore.has_action(&"back"))
	assert_false(InputCore.has_action(&"ui_accept"), "engine ui_ actions are not actions")
	assert_false(InputCore.has_action(&"nope"))


func test_action_state_operations_do_not_allocate() -> void:
	key(KEY_D, true)
	pad_axis(JOY_AXIS_LEFT_Y, 0.5)
	LogCore.release()
	for i: int in 100:
		_query_action_state()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		_query_action_state()
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects)
	assert_true(memory_after <= memory)


func _query_action_state() -> void:
	InputCore.is_pressed(&"move_right")
	InputCore.is_just_pressed(&"move_right")
	InputCore.is_just_released(&"move_right")
	InputCore.get_strength(&"move_down")
	InputCore.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")


func _press_key_then_inject() -> void:
	key(KEY_J, true)
	InputCore.inject_action(&"jump", true, 1.0)


func _release_key_then_inject() -> void:
	key(KEY_J, false)
	InputCore.inject_action(&"jump", true, 1.0)


func _press_key_and_pad_button_then_disconnect() -> void:
	key(KEY_J, true)
	pad_button(JOY_BUTTON_B, true)
	InputCoreDev.inject_gamepad_connection(0, false)


## Runs `input` after the process callbacks of the next frame and returns that frame once the reader read the two
## frames after it.
func _run_late(reader: InputCoreTestContentReader, input: Callable) -> int:
	reader.run_late(input)
	for i: int in 10:
		if reader.input_frame >= 0:
			break
		await next_frame()
	assert_true(reader.input_frame >= 0, "the input ran")
	await _wait_reads(reader, reader.input_frame + 2)
	return reader.input_frame


func _state(pressed: bool, just_pressed: bool, just_released: bool) -> String:
	return InputCoreTestContentReader.state(pressed, just_pressed, just_released)


func _wait_reads(reader: InputCoreTestContentReader, frame: int) -> void:
	for i: int in 10:
		if reader.reads.has(frame):
			return
		await next_frame()
	assert_true(reader.reads.has(frame), "the reader read frame %d" % frame)
