extends InputCoreTestCase
## Input prompt: prompt input, `input_prompt` rows, the `Generic` fallback and `InputPromptChangedEvent` for bindings.

var prompt: InputPrompt = InputPrompt.new()


func before_each() -> void:
	super()
	assert_true(await DataCore.load(null), "core test data loads")
	recorder.clear()


func test_keyboard_mouse_prompt() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_prompt(GameData.InputPromptFamily.KEYBOARD_MOUSE, "J", "icon/key_j")


func test_gamepad_family_prompt_and_generic_fallback() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.PLAY_STATION)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_prompt(GameData.InputPromptFamily.PLAY_STATION, "b", "icon/ps_circle")
	InputCoreDev.set_test_gamepad_family(GameData.InputPromptFamily.XBOX)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_prompt_row(GameData.InputPromptFamily.XBOX, "b", GameData.InputPromptFamily.GENERIC, "icon/pad_b")
	assert_true(InputCore.get_prompt(&"move_left", prompt))
	assert_eq(prompt.family, GameData.InputPromptFamily.XBOX)
	assert_eq(prompt.input, "left_x-")
	assert_eq(prompt.icon, "", "no row in the family or in Generic")
	assert_eq(prompt.name_key, "")


func test_row_without_icon() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(InputCore.get_prompt(&"move_right", prompt))
	assert_prompt(GameData.InputPromptFamily.GENERIC, "left_x+", "")


func test_touch_prompt_input_is_the_action_name() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_prompt(GameData.InputPromptFamily.TOUCH, "jump", "")


func test_prompt_input_falls_back_to_mouse_buttons_and_axis_directions() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["mouse_right"])))
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["right_y-"])))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_prompt(GameData.InputPromptFamily.KEYBOARD_MOUSE, "mouse_right", "")
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["right_y-", "y"])))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_eq(prompt.input, "y", "a gamepad button comes before an axis direction")
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["right_y-"])))
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_eq(prompt.input, "right_y-")


func test_no_prompt_input_is_false_without_a_log() -> void:
	InputCore.release()
	add_action(&"menu_info", [key_event(KEY_I)])
	add_action(&"pad_only", [pad_button_event(JOY_BUTTON_Y)])
	assert_true(InputCore.init())
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	assert_false(InputCore.get_prompt(&"menu_info", prompt))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_false(InputCore.get_prompt(&"pad_only", prompt))


func test_binding_change_changes_the_prompt() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_eq(recorder.count("prompt"), 1)
	assert_eq(recorder.of("prompt")[0].family, GameData.InputPromptFamily.KEYBOARD_MOUSE)
	assert_true(InputCore.get_prompt(&"jump", prompt))
	assert_eq(prompt.input, "H")
	assert_false(InputCore.set_keys(&"jump", PackedStringArray(["A"])))
	assert_false(InputCore.set_pad_buttons(&"jump", PackedStringArray()))
	assert_eq(recorder.count("prompt"), 1, "no event for a failed set")
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["y"])))
	InputCore.reset_keys()
	InputCore.reset_pad_buttons()
	assert_eq(recorder.count("prompt"), 4)


func test_back_prompt() -> void:
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_true(InputCore.get_prompt(&"back", prompt))
	assert_prompt(GameData.InputPromptFamily.KEYBOARD_MOUSE, "Escape", "icon/key_escape")


## `prompt` is `family` and `input` with the icon and name of the `input_prompt` row of the same family and input.
func assert_prompt(family: GameData.InputPromptFamily, input: String, icon: String) -> void:
	assert_prompt_row(family, input, family, icon)


## `prompt` is `family` and `input` with the icon and name of the `input_prompt` row of `row_family` and `input`.
func assert_prompt_row(family: GameData.InputPromptFamily, input: String, row_family: GameData.InputPromptFamily,
		icon: String) -> void:
	assert_eq(prompt.family, family)
	assert_eq(prompt.input, input)
	assert_eq(prompt.icon, icon)
	var row: GameData.InputPromptRow = null
	for candidate: GameData.InputPromptRow in GameData.InputPromptTable.all_rows():
		if candidate.family == row_family and candidate.input == input:
			row = candidate
	assert_not_null(row, "the core test data has the row")
	if row != null:
		assert_eq(prompt.name_key, row.name)
		assert_ne(prompt.name_key, "")
