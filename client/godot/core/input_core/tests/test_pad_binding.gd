extends InputCoreTestCase
## Gamepad button binding: `get_pad_buttons`, `set_pad_buttons`, `reset_pad_buttons` and `load_keys`.


func test_set_pad_buttons_rebinds_and_survives_release_init_and_load_keys() -> void:
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["y"])))
	assert_eq(pads_of(&"jump"), PackedStringArray(["y"]))
	assert_pressed_by(JOY_BUTTON_Y, JOY_BUTTON_B)
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.pad_bindings"),
		PackedStringArray(["jump=y"]))
	InputCore.release()
	assert_true(InputCore.init())
	InputCore.load_keys()
	assert_eq(pads_of(&"jump"), PackedStringArray(["y"]))
	assert_pressed_by(JOY_BUTTON_Y, JOY_BUTTON_B)
	InputCore.reset_pad_buttons()
	assert_eq(pads_of(&"jump"), PackedStringArray(["b"]))
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.pad_bindings"), PackedStringArray())
	assert_false(InputCore.set_pad_buttons(&"fire", PackedStringArray(["b"])), "jump has b")
	assert_true(InputCore.set_pad_buttons(&"cutscene_skip", PackedStringArray(["b"])), "another context")


func test_set_pad_buttons_failures_keep_every_binding() -> void:
	for names: PackedStringArray in [PackedStringArray(), PackedStringArray(["y", "y"]), PackedStringArray([""]),
			PackedStringArray(["y", "a", "x", "guide"]), PackedStringArray(["left_x+"])]:
		assert_false(InputCore.set_pad_buttons(&"jump", names), str(names))
		assert_eq(pads_of(&"jump"), PackedStringArray(["b"]))
	assert_false(InputCore.set_pad_buttons(&"jump", PackedStringArray(["nope"])))
	assert_eq(errors(), 1)
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["a", "x", "guide"])), "a and x are elsewhere in other contexts")


func test_gamepad_axis_direction_binding() -> void:
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["right_x+"])))
	pad_axis(JOY_AXIS_RIGHT_X, 0.7)
	assert_true(InputCore.is_pressed(&"jump"))
	assert_almost_eq(InputCore.get_strength(&"jump"), 0.7, 0.0001)
	pad_axis(JOY_AXIS_RIGHT_X, -0.7)
	assert_false(InputCore.is_pressed(&"jump"), "the negative direction does not press it")
	assert_false(InputCore.set_pad_buttons(&"jump", PackedStringArray(["trigger_left-"])))
	assert_eq(errors(), 1)
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["trigger_left+"])))
	pad_axis(JOY_AXIS_TRIGGER_LEFT, 0.25)
	assert_almost_eq(InputCore.get_strength(&"jump"), 0.25, 0.0001)


func test_load_pad_bindings() -> void:
	LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.pad_bindings",
		PackedStringArray(["jump=y,right_x-", "fire=trigger_left-", "move_left=y"]))
	assert_true(restart_input_core())
	InputCore.load_keys()
	assert_eq(warns(), 3, "trigger_left- is not a name; jump and move_left share y")
	assert_eq(pads_of(&"fire"), PackedStringArray(["trigger_right+"]))
	assert_eq(pads_of(&"move_left"), PackedStringArray(["left_x-"]))
	assert_eq(pads_of(&"jump"), PackedStringArray(["b"]))


## The gamepad button binding of `action`.
func pads_of(action: StringName) -> PackedStringArray:
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(MAX_PAD_BUTTONS_PER_ACTION + 2)
	var count: int = InputCore.get_pad_buttons(action, buffer)
	return buffer.slice(0, count)


## `jump` is pressed by `bound` and not by `unbound`.
func assert_pressed_by(bound: JoyButton, unbound: JoyButton) -> void:
	pad_button(unbound, true)
	assert_false(InputCore.is_pressed(&"jump"))
	pad_button(unbound, false)
	pad_button(bound, true)
	assert_true(InputCore.is_pressed(&"jump"))
	pad_button(bound, false)
	assert_false(InputCore.is_pressed(&"jump"))
