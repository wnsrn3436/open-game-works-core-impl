extends InputCoreTestCase
## The error table: each condition gives the failure value and the log.


func test_unknown_action() -> void:
	var buffer: PackedStringArray = PackedStringArray(["", ""])
	assert_false(InputCore.is_pressed(&"nope"))
	assert_false(InputCore.is_just_pressed(&"nope"))
	assert_false(InputCore.is_just_released(&"nope"))
	assert_eq(InputCore.get_strength(&"nope"), 0.0)
	assert_eq(InputCore.get_vector(&"move_left", &"move_right", &"nope", &"move_down"), Vector2.ZERO)
	assert_eq(InputCore.get_keys(&"nope", buffer), 0)
	assert_false(InputCore.set_keys(&"nope", PackedStringArray(["H"])))
	assert_eq(InputCore.get_pad_buttons(&"nope", buffer), 0)
	assert_false(InputCore.set_pad_buttons(&"nope", PackedStringArray(["y"])))
	assert_false(InputCore.get_prompt(&"nope", InputPrompt.new()))
	InputCore.inject_action(&"nope", true, 1.0)
	assert_eq(errors(), 11)
	assert_false(InputCore.has_action(&"nope"), "has_action has no log")


func test_back_in_an_action_state_operation() -> void:
	assert_false(InputCore.is_pressed(&"back"))
	assert_eq(errors(), 1)


func test_inject_strength() -> void:
	InputCore.inject_action(&"fire", true, 2.0)
	assert_eq(errors(), 1)
	assert_eq(InputCore.get_strength(&"fire"), 1.0)
	InputCore.inject_action(&"jump", true, NAN)
	assert_eq(errors(), 1)
	assert_false(InputCore.is_pressed(&"jump"))
	InputCore.inject_action(&"fire", false, NAN)
	assert_false(InputCore.is_pressed(&"fire"), "a release with a NaN strength releases")


func test_set_keys_with_a_value_that_is_not_a_name() -> void:
	assert_false(InputCore.set_keys(&"jump", PackedStringArray(["left_x+"])))
	assert_eq(errors(), 1)


func test_set_pad_buttons_with_a_value_that_is_not_a_name() -> void:
	assert_false(InputCore.set_pad_buttons(&"jump", PackedStringArray(["Space"])))
	assert_eq(errors(), 1)


func test_callbacks_that_cannot_be_called() -> void:
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	var gone: InputCoreTestRecorder = InputCoreTestRecorder.new()
	var back: Callable = gone.on_back
	var pointer: Callable = gone.on_pointer
	gone.free()
	InputCore.set_back_handler(back)
	InputCore.set_back_handler(Callable())
	InputCore.set_ui_pointer_observer(pointer)
	assert_eq(errors(), 3)
	key(KEY_ESCAPE, true)
	touch(0, true, CENTER)
	assert_eq(recorder.count("back"), 1, "the first back handler stays")
	assert_eq(recorder.count("pointer"), 1, "the first observer stays")


func test_callback_whose_object_is_destroyed_is_not_called() -> void:
	var handler: InputCoreTestRecorder = InputCoreTestRecorder.new()
	InputCore.set_back_handler(handler.on_back)
	handler.free()
	key(KEY_ESCAPE, true)
	assert_eq(errors(), 1)
	key(KEY_ESCAPE, false)
	key(KEY_ESCAPE, true)
	assert_true(InputCore._back_handler.is_null(), "the handler is dropped after its one log")


func test_unusable_pointer_position() -> void:
	touch(0, true, Vector2(INF, INF))
	assert_eq(errors(), 1)


func test_set_test_device_with_a_value_out_of_range() -> void:
	InputCoreDev.set_test_device(7 as InputCore.InputDevice)
	assert_eq(errors(), 1)


func test_dev_operations_before_init() -> void:
	InputCore.release()
	InputCoreDev.inject_device_input(key_event(KEY_J, true))
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_eq(errors(), 2)
