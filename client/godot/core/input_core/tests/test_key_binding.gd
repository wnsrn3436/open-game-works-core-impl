extends InputCoreTestCase
## Key binding: `get_keys`, `set_keys`, `reset_keys`, `load_keys`, binding contexts and the saved value.


func test_set_keys_rebinds_and_survives_release_init_and_load_keys() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_eq(keys_of(&"jump"), PackedStringArray(["H"]))
	assert_pressed_by(KEY_H, KEY_J)
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings"),
		PackedStringArray(["jump=H"]))
	InputCore.release()
	assert_true(InputCore.init())
	InputCore.load_keys()
	assert_eq(keys_of(&"jump"), PackedStringArray(["H"]))
	assert_pressed_by(KEY_H, KEY_J)


func test_set_keys_releases_the_pressed_sources_first() -> void:
	key(KEY_J, true)
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H", "J"])))
	assert_false(InputCore.is_pressed(&"jump"))


func test_set_keys_failures_keep_every_binding() -> void:
	for names: PackedStringArray in [PackedStringArray(), PackedStringArray(["H", "H"]), PackedStringArray([""]),
			PackedStringArray(["H", ""]), PackedStringArray(["H", "G", "Y", "U"]), PackedStringArray(["A"])]:
		assert_false(InputCore.set_keys(&"jump", names), str(names))
		assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))
		assert_eq(keys_of(&"move_left"), PackedStringArray(["A"]))
	assert_eq(errors(), 0, "no log, also for a list with the empty string")
	assert_false(InputCore.set_keys(&"jump", PackedStringArray(["H", "NotAKey"])))
	assert_eq(errors(), 1)
	assert_false(InputCore.set_keys(&"jump", PackedStringArray(["Shift+H"])))
	assert_eq(errors(), 1)
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H", "G", "Y"])), "the limit itself")


func test_reset_keys() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_true(InputCore.set_keys(&"back", PackedStringArray(["Backspace"])))
	key(KEY_H, true)
	InputCore.reset_keys()
	assert_false(InputCore.is_pressed(&"jump"))
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))
	assert_eq(keys_of(&"back"), PackedStringArray(["Escape"]))
	assert_eq(LocalDataCore.get_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings"), PackedStringArray())
	InputCore.load_keys()
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))
	assert_eq(keys_of(&"back"), PackedStringArray(["Escape"]))


func test_reset_keys_keeps_the_gamepad_button_bindings() -> void:
	var defaults: Dictionary[StringName, PackedStringArray] = {}
	for action: StringName in InputCore._action_names:
		defaults[action] = keys_of(action)
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_true(InputCore.set_keys(&"back", PackedStringArray(["Backspace"])))
	assert_true(InputCore.set_pad_buttons(&"jump", PackedStringArray(["y"])))
	InputCore.reset_keys()
	for action: StringName in defaults:
		assert_eq(keys_of(action), defaults[action], String(action))
	assert_eq(pads_of(&"jump"), PackedStringArray(["y"]), "reset_keys does not change the gamepad button binding")
	InputCore.load_keys()
	for action: StringName in defaults:
		assert_eq(keys_of(action), defaults[action], String(action) + " after load_keys")
	assert_eq(pads_of(&"jump"), PackedStringArray(["y"]))
	pad_button(JOY_BUTTON_Y, true)
	assert_true(InputCore.is_pressed(&"jump"))
	pad_button(JOY_BUTTON_Y, false)


func test_mouse_button_in_a_key_binding() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["mouse_right"])))
	assert_eq(keys_of(&"jump"), PackedStringArray(["mouse_right"]))
	mouse_button(MOUSE_BUTTON_RIGHT, true)
	assert_true(InputCore.is_pressed(&"jump"))
	mouse_button(MOUSE_BUTTON_RIGHT, false)
	assert_false(InputCore.is_pressed(&"jump"))
	InputCore.release()
	assert_true(InputCore.init())
	InputCore.load_keys()
	assert_eq(keys_of(&"jump"), PackedStringArray(["mouse_right"]))
	mouse_button(MOUSE_BUTTON_RIGHT, true)
	assert_true(InputCore.is_pressed(&"jump"))
	assert_false(InputCore.set_keys(&"fire", PackedStringArray(["mouse_right"])), "jump has mouse_right")
	assert_true(InputCore.set_keys(&"menu_ok", PackedStringArray(["mouse_right"])), "menu_ok is in another context")


func test_mouse_left_in_a_key_binding_is_pressed_by_the_pointer() -> void:
	assert_true(InputCore.set_keys(&"fire", PackedStringArray(["mouse_left"])))
	mouse_button(MOUSE_BUTTON_LEFT, true)
	assert_true(InputCore.is_pressed(&"fire"))
	mouse_button(MOUSE_BUTTON_LEFT, false)
	assert_false(InputCore.is_pressed(&"fire"))
	touch(0, true, CENTER)
	assert_false(InputCore.is_pressed(&"fire"), "the mouse input the engine made from touch does not press it")


func test_binding_contexts() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["Space"])), "cutscene_advance is in another context")
	assert_false(InputCore.set_keys(&"jump", PackedStringArray(["A"])), "move_left is an overlapping action")
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["Escape"])), "back is in the Ui context")
	assert_false(InputCore.set_keys(&"menu_ok", PackedStringArray(["Escape"])), "menu_ok overlaps back")
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["H"])))
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["Space"])))
	assert_true(InputCore.set_keys(&"back", PackedStringArray(["Escape", "Backspace"])), "back can change")
	assert_eq(keys_of(&"back"), PackedStringArray(["Escape", "Backspace"]))


func test_load_keys_skips_bad_saved_values() -> void:
	LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings", PackedStringArray([
		"jump=H", "malformed", "=G", "nope=G", "fire=G", "fire=Y", "move_up=", "move_down=Q,Q",
		"menu_ok=Z,X,C,V", "move_left=NotAKey", "cutscene_skip=", "back=Backspace",
	]))
	assert_true(restart_input_core())
	recorder.clear()
	InputCore.load_keys()
	assert_eq(warns(), 9)
	assert_eq(keys_of(&"jump"), PackedStringArray(["H"]))
	assert_eq(keys_of(&"back"), PackedStringArray(["Backspace"]))
	assert_eq(keys_of(&"fire"), PackedStringArray(["F"]))
	assert_eq(keys_of(&"move_up"), PackedStringArray(["W"]))
	assert_eq(keys_of(&"move_down"), PackedStringArray(["S"]))
	assert_eq(keys_of(&"menu_ok"), PackedStringArray(["K"]))
	assert_eq(keys_of(&"move_left"), PackedStringArray(["A"]))
	assert_eq(recorder.count("prompt"), 1, "one prompt change for the load")


func test_load_keys_checks_the_count_first() -> void:
	LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings",
		PackedStringArray(["jump=H,H,NotAKey,G"]))
	assert_true(restart_input_core())
	InputCore.load_keys()
	assert_eq(warns(), 1)
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))


func test_load_keys_drops_both_actions_that_share_a_key_in_any_order() -> void:
	for items: PackedStringArray in [PackedStringArray(["move_left=Y", "move_right=Y", "jump=H"]),
			PackedStringArray(["jump=H", "move_right=Y", "move_left=Y"])]:
		LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings", items)
		assert_true(restart_input_core())
		InputCore.load_keys()
		assert_eq(warns(), 2)
		assert_eq(keys_of(&"move_left"), PackedStringArray(["A"]))
		assert_eq(keys_of(&"move_right"), PackedStringArray(["D"]))
		assert_eq(keys_of(&"jump"), PackedStringArray(["H"]))


func test_load_keys_drops_an_action_that_overlaps_an_action_not_applied() -> void:
	LocalDataCore.set_array_string(LocalDataCore.FileKind.DEVICE, "InputCore.key_bindings",
		PackedStringArray(["move_up=D", "fire=W", "jump=J,F"]))
	assert_true(restart_input_core())
	InputCore.load_keys()
	assert_eq(warns(), 3, "move_up has move_right's D; fire and jump then lose to the bindings kept")
	assert_eq(keys_of(&"move_up"), PackedStringArray(["W"]))
	assert_eq(keys_of(&"fire"), PackedStringArray(["F"]))
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))


func test_load_keys_without_saved_values_changes_nothing() -> void:
	recorder.clear()
	InputCore.load_keys()
	assert_eq(recorder.count("prompt"), 0)
	assert_eq(keys_of(&"jump"), PackedStringArray(["J"]))


func test_get_keys_of_back_and_a_small_buffer() -> void:
	assert_eq(keys_of(&"back"), PackedStringArray(["Escape"]))
	var pads: PackedStringArray = PackedStringArray(["", "", ""])
	assert_eq(InputCore.get_pad_buttons(&"back", pads), 1)
	assert_eq(pads[0], "b")
	var small: PackedStringArray = PackedStringArray([""])
	assert_eq(InputCore.get_keys(&"cutscene_advance", small), 1)
	assert_eq(small[0], "Space")
	assert_eq(errors(), 1, "the buffer is smaller than the binding")


## The key binding of `action`.
func pads_of(action: StringName) -> PackedStringArray:
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(MAX_PAD_BUTTONS_PER_ACTION + 2)
	var count: int = InputCore.get_pad_buttons(action, buffer)
	return buffer.slice(0, count)


func keys_of(action: StringName) -> PackedStringArray:
	var buffer: PackedStringArray = PackedStringArray()
	buffer.resize(MAX_KEYS_PER_ACTION + 2)
	var count: int = InputCore.get_keys(action, buffer)
	return buffer.slice(0, count)


## `jump` is pressed by `bound` and not by `unbound`.
func assert_pressed_by(bound: Key, unbound: Key) -> void:
	key(unbound, true)
	assert_false(InputCore.is_pressed(&"jump"))
	key(unbound, false)
	key(bound, true)
	assert_true(InputCore.is_pressed(&"jump"))
	key(bound, false)
	assert_false(InputCore.is_pressed(&"jump"))
