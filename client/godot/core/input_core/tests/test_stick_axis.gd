extends InputCoreTestCase
## Stick axis options: `set_pad_axis_inverted`, `is_pad_axis_inverted`, `set_pad_axis_sensitivity`,
## `get_pad_axis_sensitivity`, `list_pad_axis_sensitivities`, `reset_pad_axes` and their `load_keys`. The gamepad
## button bindings are `look_up` [`right_y-`], `look_down` [`right_y+`], `look_right` [`right_x+`] (`Gameplay`
## actions), `menu_down` [`right_y+`] and `menu_right` [`right_x+`] (`Ui` actions).

const DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
const INVERTED_KEY: String = "InputCore.pad_axis_inverted"
const SENSITIVITY_KEY: String = "InputCore.pad_axis_sensitivity"
const STICK_AXES: Array[String] = ["left_x", "left_y", "right_x", "right_y"]

var prompt: InputPrompt = InputPrompt.new()


func before_each() -> void:
	super()
	InputCore.release()
	add_stick_actions(true)
	assert_true(InputCore.init(), "init with the stick actions")
	recorder.clear()


func test_inverted_axis_takes_the_other_direction_for_gameplay_actions() -> void:
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	assert_inverted_right_y()
	assert_eq(LocalDataCore.get_array_string(DEVICE, INVERTED_KEY), PackedStringArray(["right_y"]))
	pad_axis(JOY_AXIS_RIGHT_Y, 0.0)
	assert_false(InputCore.is_pressed(&"look_up"))
	InputCore.release()
	assert_true(InputCore.init())
	assert_false(InputCore.is_pad_axis_inverted("right_y"), "init starts from the default")
	InputCore.load_keys()
	assert_inverted_right_y()
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_prompt_follows_the_inversion() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(InputCore.get_prompt(&"look_up", prompt))
	assert_eq(prompt.input, "right_y-")
	recorder.clear()
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	assert_eq(recorder.count("prompt"), 1)
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.GENERIC)
	assert_true(InputCore.get_prompt(&"look_up", prompt))
	assert_eq(prompt.input, "right_y+", "a Gameplay action shows the other direction")
	assert_true(InputCore.get_prompt(&"menu_down", prompt))
	assert_eq(prompt.input, "right_y+", "a Ui action keeps its direction")
	assert_true(InputCore.get_prompt(&"look_down", prompt))
	assert_eq(prompt.input, "right_y-")
	assert_true(InputCore.set_pad_axis_inverted("right_y", true), "the current value")
	assert_true(InputCore.set_pad_axis_sensitivity("right_y", 2000))
	assert_eq(recorder.count("prompt"), 1, "neither publishes InputPromptChangedEvent")
	assert_true(InputCore.set_pad_axis_inverted("right_y", false))
	assert_eq(recorder.count("prompt"), 2)
	assert_true(InputCore.get_prompt(&"look_up", prompt))
	assert_eq(prompt.input, "right_y-")


func test_sensitivity_scales_gameplay_sources_only() -> void:
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 2000))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 2000)
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray(["right_x=2000"]))
	pad_axis(JOY_AXIS_RIGHT_X, 0.3)
	assert_almost_eq(InputCore.get_strength(&"look_right"), 0.6, 0.0001)
	assert_almost_eq(InputCore.get_strength(&"menu_right"), 0.3, 0.0001)
	pad_axis(JOY_AXIS_RIGHT_X, 0.8)
	assert_almost_eq(InputCore.get_strength(&"look_right"), 1.0, 0.0001, "at most 1")
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 500))
	pad_axis(JOY_AXIS_RIGHT_X, 1.0)
	assert_almost_eq(InputCore.get_strength(&"look_right"), 0.5, 0.0001)
	assert_almost_eq(InputCore.get_strength(&"menu_right"), 1.0, 0.0001)
	assert_eq(InputCore.get_pad_axis_sensitivity("left_x"), 1000)
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 500)
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray(["right_x=500"]))
	pad_axis(JOY_AXIS_RIGHT_X, 0.0)
	start_wait_pad_button()
	pad_axis(JOY_AXIS_RIGHT_X, PAD_AXIS_WAIT_THRESHOLD)
	assert_eq(pad_result, "right_x+", "key wait uses the direction strength")
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 1000))
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray(),
		"a key whose list becomes empty is deleted")
	assert_eq(errors(), 0)


func test_list_pad_axis_sensitivities() -> void:
	var buffer: PackedInt32Array = PackedInt32Array()
	buffer.resize(3)
	assert_eq(InputCore.list_pad_axis_sensitivities(buffer), 3)
	assert_eq(buffer, PackedInt32Array([500, 1000, 2000]), "ascending order")
	assert_eq(errors(), 0)
	var small: PackedInt32Array = PackedInt32Array([0, 0])
	assert_eq(InputCore.list_pad_axis_sensitivities(small), 2)
	assert_eq(small, PackedInt32Array([500, 1000]))
	assert_eq(errors(), 1, "a buffer smaller than the list")
	var ten: Array[int] = [1000, 1, 2, 3, 4, 5, 6, 7, 8, 9]
	InputCore.release()
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisSensitivities", PackedInt64Array(ten)))
	assert_true(InputCore.init())
	var full: PackedInt32Array = PackedInt32Array()
	full.resize(10)
	assert_eq(InputCore.list_pad_axis_sensitivities(full), 10)
	assert_eq(full, PackedInt32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]))
	assert_eq(errors(), 0, "a buffer of length 10 holds every value")
	ten.append(10)
	InputCore.release()
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisSensitivities", PackedInt64Array(ten)))
	assert_false(InputCore.init(), "11 values")
	assert_eq(errors(), 1)


func test_init_fails_with_sensitivities_out_of_range() -> void:
	var cases: Array[PackedInt64Array] = [
		PackedInt64Array(), PackedInt64Array([500, 2000]), PackedInt64Array([1000, 0]),
		PackedInt64Array([1000, -500]), PackedInt64Array([1000, 500, 500]), PackedInt64Array([1000, 10001]),
		PackedInt64Array([1000, 3000000000]),
	]
	for values: PackedInt64Array in cases:
		InputCore.release()
		assert_true(UnitTestCore.set_test_settings("InputCore.padAxisSensitivities", values))
		assert_false(InputCore.init(), str(values))
		assert_eq(errors(), 1, str(values))
		assert_false(InputCore.is_initialized())
	InputCore.release()
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisSensitivities", PackedInt64Array([1000])))
	assert_true(InputCore.init(), "1000 alone")
	InputCore.release()
	assert_true(UnitTestCore.set_test_settings("InputCore.padAxisSensitivities", PackedInt64Array([1, 1000, 10000])))
	assert_true(InputCore.init(), "1 and 10000 are allowed")
	var bounds: PackedInt32Array = PackedInt32Array()
	bounds.resize(3)
	assert_eq(InputCore.list_pad_axis_sensitivities(bounds), 3)
	assert_eq(bounds, PackedInt32Array([1, 1000, 10000]))
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 10000))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 10000)
	assert_eq(errors(), 0)


func test_wrong_axis_names_and_sensitivities_change_nothing() -> void:
	assert_false(InputCore.set_pad_axis_sensitivity("right_x", 750))
	assert_eq(errors(), 1)
	assert_false(InputCore.set_pad_axis_inverted("trigger_left", true))
	assert_eq(errors(), 1)
	assert_false(InputCore.set_pad_axis_sensitivity("trigger_right", 2000))
	assert_eq(errors(), 1)
	assert_false(InputCore.is_pad_axis_inverted("right_y+"))
	assert_eq(errors(), 1)
	assert_eq(InputCore.get_pad_axis_sensitivity(""), 1000)
	assert_eq(errors(), 1)
	assert_default_options()
	assert_eq(LocalDataCore.get_array_string(DEVICE, INVERTED_KEY), PackedStringArray())
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray())
	assert_eq(recorder.count("prompt"), 0)
	InputCore.release()
	assert_false(InputCore.set_pad_axis_inverted("right_y", true))
	assert_false(InputCore.is_pad_axis_inverted("right_y"))
	assert_false(InputCore.set_pad_axis_sensitivity("right_y", 2000))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_y"), 1000)
	assert_eq(InputCore.list_pad_axis_sensitivities(PackedInt32Array([0])), 0)
	InputCore.reset_pad_axes()
	assert_eq(errors(), 6, "before init")


func test_changing_an_option_releases_the_affected_sources() -> void:
	pad_axis(JOY_AXIS_RIGHT_Y, -0.6)
	assert_true(InputCore.is_pressed(&"look_up"))
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	assert_false(InputCore.is_pressed(&"look_up"))
	pad_axis(JOY_AXIS_RIGHT_Y, -0.6)
	assert_false(InputCore.is_pressed(&"look_up"))
	assert_true(InputCore.is_pressed(&"look_down"))
	assert_almost_eq(InputCore.get_strength(&"look_down"), 0.6, 0.0001)
	pad_axis(JOY_AXIS_RIGHT_X, 0.5)
	assert_true(InputCore.is_pressed(&"look_right"))
	assert_true(InputCore.is_pressed(&"menu_right"))
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 2000))
	assert_false(InputCore.is_pressed(&"look_right"))
	assert_true(InputCore.is_pressed(&"menu_right"), "a Ui action keeps its source")
	assert_true(InputCore.is_pressed(&"look_down"), "another stick axis keeps its sources")
	InputCore.reset_pad_axes()
	assert_false(InputCore.is_pressed(&"look_down"))
	assert_true(InputCore.is_pressed(&"menu_right"))


func test_reset_pad_axes() -> void:
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	assert_true(InputCore.set_pad_axis_sensitivity("right_x", 2000))
	assert_true(InputCore.set_pad_buttons(&"look_right", PackedStringArray(["right_x-"])))
	assert_eq(LocalDataCore.get_array_string(DEVICE, INVERTED_KEY), PackedStringArray(["right_y"]))
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray(["right_x=2000"]))
	recorder.clear()
	InputCore.reset_pad_axes()
	assert_default_options()
	assert_eq(recorder.count("prompt"), 1)
	assert_eq(LocalDataCore.get_array_string(DEVICE, INVERTED_KEY), PackedStringArray())
	assert_eq(LocalDataCore.get_array_string(DEVICE, SENSITIVITY_KEY), PackedStringArray())
	assert_eq(pads_of(&"look_right"), PackedStringArray(["right_x-"]), "the bindings stay")
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	assert_true(InputCore.set_pad_axis_sensitivity("left_x", 500))
	InputCore.reset_pad_buttons()
	InputCore.reset_keys()
	assert_true(InputCore.is_pad_axis_inverted("right_y"), "reset_pad_buttons and reset_keys keep the options")
	assert_eq(InputCore.get_pad_axis_sensitivity("left_x"), 500)
	assert_eq(pads_of(&"look_right"), PackedStringArray(["right_x+"]))
	assert_true(InputCore.set_pad_axis_inverted("right_y", false))
	recorder.clear()
	InputCore.reset_pad_axes()
	assert_eq(recorder.count("prompt"), 0, "no inversion turned off")
	assert_default_options()


func test_device_detection_and_block_stage_use_the_source_strength() -> void:
	InputCore.release()
	add_stick_actions(false)
	assert_true(InputCore.init())
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(InputCore.set_pad_axis_inverted("right_y", true))
	recorder.clear()
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_RIGHT_Y, -0.6), 0)
	assert_false(InputCore.is_pressed(&"look_up"))
	assert_eq(recorder.count("device"), 0)
	assert_eq(InputCore.get_last_gamepad(), -1)
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	InputCoreDev.inject_device_input(pad_axis_event(JOY_AXIS_RIGHT_Y, 0.6), 0)
	assert_true(InputCore.is_pressed(&"look_up"))
	assert_eq(recorder.count("device"), 1)
	assert_eq(recorder.of("device")[0].device, InputCore.InputDevice.GAMEPAD)
	assert_eq(InputCore.get_last_gamepad(), 0)
	pad_axis(JOY_AXIS_RIGHT_Y, 0.0)
	assert_false(InputCore.is_pressed(&"look_up"))
	var token: int = block_with([&"look_up"], [])
	pad_axis(JOY_AXIS_RIGHT_Y, 0.6)
	assert_true(InputCore.is_pressed(&"look_up"), "the block stage passes look_up")
	assert_almost_eq(InputCore.get_strength(&"look_up"), 0.6, 0.0001)
	pad_axis(JOY_AXIS_RIGHT_Y, 0.0)
	assert_false(InputCore.is_pressed(&"look_up"), "the release passes too")
	unblock(token)


func test_load_keys_applies_the_saved_options() -> void:
	LocalDataCore.set_array_string(DEVICE, INVERTED_KEY, PackedStringArray(["right_y", "trigger_left"]))
	LocalDataCore.set_array_string(DEVICE, SENSITIVITY_KEY, PackedStringArray(["right_x=2000", "left_x=750", "left_y"]))
	assert_true(restart_input_core())
	recorder.clear()
	InputCore.load_keys()
	assert_eq(warns(), 3, "trigger_left, left_x=750 and left_y")
	assert_true(InputCore.is_pad_axis_inverted("right_y"))
	assert_false(InputCore.is_pad_axis_inverted("left_y"))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 2000)
	assert_eq(InputCore.get_pad_axis_sensitivity("left_x"), 1000)
	assert_eq(InputCore.get_pad_axis_sensitivity("left_y"), 1000)
	assert_eq(recorder.count("prompt"), 1, "a saved inversion was applied")
	assert_eq(errors(), 0)


func test_load_keys_releases_the_sources_of_changed_axes() -> void:
	pad_axis(JOY_AXIS_RIGHT_Y, -0.6)
	pad_axis(JOY_AXIS_RIGHT_X, 0.5)
	assert_true(InputCore.is_pressed(&"look_up"))
	assert_true(InputCore.is_pressed(&"look_right"))
	assert_true(InputCore.is_pressed(&"menu_right"))
	LocalDataCore.set_array_string(DEVICE, INVERTED_KEY, PackedStringArray(["right_y"]))
	LocalDataCore.set_array_string(DEVICE, SENSITIVITY_KEY, PackedStringArray(["right_x=2000"]))
	InputCore.load_keys()
	assert_true(InputCore.is_pad_axis_inverted("right_y"))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 2000)
	assert_false(InputCore.is_pressed(&"look_up"), "the inversion of right_y releases look_up")
	assert_false(InputCore.is_pressed(&"look_right"), "the sensitivity of right_x releases look_right")
	assert_true(InputCore.is_pressed(&"menu_right"), "a Ui action keeps its source")
	pad_axis(JOY_AXIS_RIGHT_X, 0.3)
	assert_true(InputCore.is_pressed(&"look_right"))
	assert_almost_eq(InputCore.get_strength(&"look_right"), 0.6, 0.0001)
	pad_axis(JOY_AXIS_RIGHT_Y, 0.0)
	pad_axis(JOY_AXIS_RIGHT_X, 0.0)
	pad_axis(JOY_AXIS_RIGHT_Y, -0.6)
	assert_true(InputCore.is_pressed(&"look_down"))
	recorder.clear()
	InputCore.load_keys()
	assert_true(InputCore.is_pressed(&"look_down"), "load_keys with the current options releases nothing")
	assert_eq(errors(), 0)
	assert_eq(warns(), 0)


func test_load_keys_skips_an_axis_saved_twice() -> void:
	LocalDataCore.set_array_string(DEVICE, INVERTED_KEY, PackedStringArray(["right_y", "right_y", "left_x"]))
	LocalDataCore.set_array_string(DEVICE, SENSITIVITY_KEY,
		PackedStringArray(["right_x=2000", "right_x=500", "left_y=500", "stick=2000", "left_x=abc"]))
	assert_true(restart_input_core())
	recorder.clear()
	InputCore.load_keys()
	assert_eq(warns(), 4, "right_y twice, right_x twice, stick and left_x=abc")
	assert_false(InputCore.is_pad_axis_inverted("right_y"))
	assert_true(InputCore.is_pad_axis_inverted("left_x"))
	assert_eq(InputCore.get_pad_axis_sensitivity("right_x"), 1000)
	assert_eq(InputCore.get_pad_axis_sensitivity("left_y"), 500)
	LocalDataCore.remove_value(DEVICE, INVERTED_KEY)
	assert_true(restart_input_core())
	recorder.clear()
	InputCore.load_keys()
	assert_eq(warns(), 3, "right_x twice, stick and left_x=abc")
	assert_eq(InputCore.get_pad_axis_sensitivity("left_y"), 500)
	assert_eq(recorder.count("prompt"), 0, "a saved sensitivity alone publishes no event")


## Adds the stick actions to the input map: with `all`, every action of the file comment; otherwise only `look_up`
## [`right_y-`] and `look_right` [`right_x+`], so that `look_up` is the only binding with a `right_y` direction.
func add_stick_actions(all: bool) -> void:
	add_action(&"look_up", [pad_axis_event(JOY_AXIS_RIGHT_Y, -1.0)])
	add_action(&"look_right", [pad_axis_event(JOY_AXIS_RIGHT_X, 1.0)])
	for action: StringName in [&"look_down", &"menu_down", &"menu_right"]:
		if InputMap.has_action(action):
			InputMap.erase_action(action)
	if not all:
		return
	add_action(&"look_down", [pad_axis_event(JOY_AXIS_RIGHT_Y, 1.0)])
	add_action(&"menu_down", [pad_axis_event(JOY_AXIS_RIGHT_Y, 1.0)])
	add_action(&"menu_right", [pad_axis_event(JOY_AXIS_RIGHT_X, 1.0)])


## With `right_y` inverted, a `right_y` value 0.6 presses `look_up` and `menu_down` with strength 0.6 and not
## `look_down`, and the binding of `look_up` stays [`right_y-`].
func assert_inverted_right_y() -> void:
	assert_true(InputCore.is_pad_axis_inverted("right_y"))
	pad_axis(JOY_AXIS_RIGHT_Y, 0.6)
	assert_true(InputCore.is_pressed(&"look_up"))
	assert_almost_eq(InputCore.get_strength(&"look_up"), 0.6, 0.0001)
	assert_false(InputCore.is_pressed(&"look_down"))
	assert_true(InputCore.is_pressed(&"menu_down"))
	assert_almost_eq(InputCore.get_strength(&"menu_down"), 0.6, 0.0001)
	assert_eq(pads_of(&"look_up"), PackedStringArray(["right_y-"]))


## Every stick axis is not inverted and has sensitivity 1000.
func assert_default_options() -> void:
	for axis_name: String in STICK_AXES:
		assert_false(InputCore.is_pad_axis_inverted(axis_name), axis_name)
		assert_eq(InputCore.get_pad_axis_sensitivity(axis_name), 1000, axis_name)


## The gamepad button binding of `action`.
func pads_of(action: StringName) -> PackedStringArray:
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(MAX_PAD_BUTTONS_PER_ACTION + 2)
	var count: int = InputCore.get_pad_buttons(action, buffer)
	return buffer.slice(0, count)
