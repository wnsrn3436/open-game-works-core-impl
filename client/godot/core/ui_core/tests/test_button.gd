extends "res://core/ui_core/tests/support/ui_test_case.gd"
## `UIButton`: click interval, click sound, click callback and action clicks.

const LATE_INPUT := preload("res://core/ui_core/tests/support/ui_test_late_input.gd")

## Gamepad button `a` as the engine accept input. The engine default `ui_accept` has no gamepad button.
var _pad_accept: InputEventJoypadButton = null
## Other gamepad buttons and axes a test adds to the engine accept input.
var _added_accepts: Array[InputEvent] = []


func before_each() -> void:
	super()
	_pad_accept = null
	for event: InputEvent in InputMap.action_get_events(&"ui_accept"):
		var pad: InputEventJoypadButton = event as InputEventJoypadButton
		if pad != null and pad.button_index == JOY_BUTTON_A:
			return
	_pad_accept = InputEventJoypadButton.new()
	_pad_accept.button_index = JOY_BUTTON_A
	_pad_accept.device = -1
	InputMap.action_add_event(&"ui_accept", _pad_accept)


func after_each() -> void:
	await super()
	if _pad_accept != null:
		InputMap.action_erase_event(&"ui_accept", _pad_accept)
	for event: InputEvent in _added_accepts:
		InputMap.action_erase_event(&"ui_accept", event)
	_added_accepts = []


func test_click_interval_across_buttons() -> void:
	assert_true(await start())
	var first: Button = add_button(UICore.UILayer.SCENE_UI, "first", Vector2(100, 100))
	var second: Button = add_button(UICore.UILayer.SCENE_UI, "second", Vector2(400, 100))
	await UnitTestCore.wait_frames(1)
	await tap_control(first)
	assert_eq(clicks, PackedStringArray(["first"]))
	assert_eq(ui_sounds, 1)
	await advance(CLICK_INTERVAL_MS - 1)
	await tap_control(second)
	assert_eq(clicks.size(), 1, "no callback inside the interval, even for another button")
	assert_eq(ui_sounds, 1, "no sound inside the interval")
	await advance(1)
	await tap_control(second)
	assert_eq(clicks, PackedStringArray(["first", "second"]))
	assert_eq(ui_sounds, 2)


func test_set_on_click_replaces_and_clears() -> void:
	assert_true(await start())
	var button: Button = add_button(UICore.UILayer.SCENE_UI, "old", Vector2(100, 100))
	var ui_button: UIButton = ui_button_of(button)
	ui_button.set_on_click(click_of("new"))
	await UnitTestCore.wait_frames(1)
	await tap_control(button)
	assert_eq(clicks, PackedStringArray(["new"]))
	ui_button.set_on_click(Callable())
	await advance(CLICK_INTERVAL_MS)
	await tap_control(button)
	assert_eq(clicks.size(), 1, "no callback after the empty callback")
	button.queue_free()
	await UnitTestCore.wait_frames(2)
	assert_eq(errors() + warns(), 0, "no log after the button is destroyed")


func test_action_click() -> void:
	assert_true(await start())
	var button: Button = add_button(UICore.UILayer.SCENE_UI, "action", Vector2(100, 100))
	var ui_button: UIButton = ui_button_of(button)
	button.remove_child(ui_button)
	ui_button.action = "cutscene_advance"
	button.add_child(ui_button)
	await UnitTestCore.wait_frames(1)
	await press_key(KEY_SPACE)
	assert_eq(clicks, PackedStringArray(["action"]), "one click callback")
	assert_eq(ui_sounds, 1, "one click sound")
	await advance(CLICK_INTERVAL_MS)
	button.visible = false
	await press_key(KEY_SPACE)
	assert_eq(clicks.size(), 1, "no click while it is not visible")
	button.visible = true
	assert_true(await UICore.open_popup(POPUP_A, null, Callable()) == UICore.PopupOpenResult.OPENED)
	await advance(CLICK_INTERVAL_MS)
	await press_key(KEY_SPACE)
	assert_eq(clicks.size(), 1, "no click while modal covered")
	UICore.close_all_popups()
	var token: int = InputBlockCore.block("content")
	await advance(CLICK_INTERVAL_MS)
	await press_key(KEY_SPACE)
	assert_eq(clicks.size(), 1, "no click under a block that does not pass the action")
	InputBlockCore.unblock(token)


## A focused button whose action is also the accept input: one device input, at the frame signal or after the content
## code of a frame, is one click callback and one click sound, with no click interval.
func test_accept_and_action_of_one_input_click_once() -> void:
	set_int("UICore.buttonClickIntervalMs", 0)
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_FOCUS, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var button: Button = named_button(popup_of(POPUP_FOCUS), "Second")
	var ui_button: UIButton = ui_button_of(button)
	button.remove_child(ui_button)
	ui_button.action = "cutscene_advance"
	button.add_child(ui_button)
	ui_button.set_on_click(click_of("second"))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), button, "the focus element")
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(1)
	assert_eq(clicks, PackedStringArray(["second"]), "one click by an input at the frame signal")
	assert_eq(ui_sounds, 1, "one click sound by an input at the frame signal")
	var late: LATE_INPUT = LATE_INPUT.new()
	add_child_autofree(late)
	var press: InputEventJoypadButton = InputEventJoypadButton.new()
	press.button_index = JOY_BUTTON_A
	press.pressed = true
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	late.steps = [InputCoreDev.inject_device_input.bind(press), InputCoreDev.inject_device_input.bind(release)]
	await UnitTestCore.wait_frames(1)
	assert_true(late.done, "the input is injected after the content code")
	await UnitTestCore.wait_frames(2)
	assert_eq(clicks, PackedStringArray(["second", "second"]), "one click by an input after the content code")
	assert_eq(ui_sounds, 2, "one click sound by an input after the content code")


## A device input in the process callbacks before `UICore` whose pending frame an inject press and release of the
## action stamp with this frame: its accept click and action click are one click.
func test_accept_input_stamped_by_inject_clicks_once() -> void:
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_A, true), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, false), InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks, PackedStringArray(["second"]), "one click callback")
	assert_eq(ui_sounds, 1, "one click sound")


## An accept input that is not a binding of the action gets the next frame whether an inject press of the action comes
## before or after it: the action click of this frame is a click of its own.
func test_accept_input_not_bound_to_the_action_clicks_apart() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	await _inject_early([InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _pad(JOY_BUTTON_X, true),
			_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "an inject press before the accept input")
	assert_eq(ui_sounds, 2, "an inject press before the accept input")
	await _inject_early([_pad(JOY_BUTTON_X, true), _pad(JOY_BUTTON_X, false),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks.size(), 4, "an inject press after the accept input")
	assert_eq(ui_sounds, 4, "an inject press after the accept input")


## An accept input that is a binding of the action, after an inject press of the action in the same frame, gets the
## next frame unless an inject input of the action comes after it.
func test_accept_input_after_an_inject_press_of_its_action() -> void:
	await _focus_action_button()
	await _inject_early([InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _pad(JOY_BUTTON_A, true),
			_pad(JOY_BUTTON_A, false)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "no inject input after the accept input")
	assert_eq(ui_sounds, 2, "no inject input after the accept input")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	await UnitTestCore.wait_frames(1)
	await _inject_early([InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _pad(JOY_BUTTON_A, true),
			_pad(JOY_BUTTON_A, false), InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks.size(), 3, "an inject release after the accept input")
	assert_eq(ui_sounds, 3, "an inject release after the accept input")


## The state the accept click is judged by is the state before the press of the accept input that clicks, not before an
## earlier accept event of the frame, and not before its release.
func test_accept_state_is_taken_at_the_press_of_the_clicking_input() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "an accept release with no click before the inject press")
	assert_eq(ui_sounds, 2, "an accept release with no click before the inject press")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	await UnitTestCore.wait_frames(1)
	await _inject_early([_pad(JOY_BUTTON_X, false), _pad(JOY_BUTTON_A, true),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _pad(JOY_BUTTON_A, false)])
	assert_eq(clicks.size(), 3, "an inject press between the press and the release of the accept input")
	assert_eq(ui_sounds, 3, "an inject press between the press and the release of the accept input")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)


## While another accept input is held, the accept click is judged by the accept input that clicks (the one pressed and
## released), not by the held one: a click by a binding of the action is one click with the action click of its frame.
func test_accept_click_by_a_bound_input_while_another_accept_input_is_held() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_X, true), _pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0)])
	assert_eq(clicks, PackedStringArray(["second"]), "one click callback")
	assert_eq(ui_sounds, 1, "one click sound")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)


## While a binding of the action is held as an accept input, a click by an accept input that is not a binding gets the
## next frame: the action click of this frame is a click of its own.
func test_accept_click_by_an_unbound_input_while_a_bound_accept_input_is_held() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["x"])))
	await _inject_early([_pad(JOY_BUTTON_X, true), _pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "two click callbacks")
	assert_eq(ui_sounds, 2, "two click sounds")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	InputCore.reset_pad_buttons()


## A gamepad axis accept input held past its press sends a press event at each axis value change: the accept click is
## judged by the state before its first press, so an inject press of the action between the two is one click with it,
## as for a gamepad button.
func test_accept_axis_held_past_its_press_is_judged_at_its_first_press() -> void:
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_A, true), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, false)])
	assert_eq(clicks, PackedStringArray(["second"]), "a gamepad button")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	await UnitTestCore.wait_frames(1)
	clicks.clear()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	assert_eq(clicks, PackedStringArray(["second"]), "an axis with no value change while held")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	await UnitTestCore.wait_frames(1)
	clicks.clear()
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8),
			InputCore.inject_action.bind(&"cutscene_advance", true, 1.0), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.9),
			_axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	assert_eq(clicks, PackedStringArray(["second"]), "an axis with a value change while held")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	InputCore.reset_pad_buttons()


## An accept input pressed again after its release is judged by the state before the new press when that press is not
## the first accept event of its frame.
func test_accept_input_pressed_again_after_its_release_is_judged_at_the_new_press() -> void:
	_add_accept(JOY_BUTTON_X)
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false)])
	clicks.clear()
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "a gamepad button")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	await UnitTestCore.wait_frames(1)
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	clicks.clear()
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "a gamepad axis")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	InputCore.reset_pad_buttons()


## A gamepad button accept input held at the app focus loss gets no release event: its next press is a press of its own,
## judged by the state before it.
func test_accept_button_pressed_again_after_the_focus_loss_is_judged_at_the_new_press() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	await _inject_early([_pad(JOY_BUTTON_A, true)])
	InputCoreDev.inject_focus_lost()
	_refocus()
	clicks.clear()
	var sounds: int = ui_sounds
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, true), _pad(JOY_BUTTON_A, false)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "two click callbacks")
	assert_eq(ui_sounds - sounds, 2, "two click sounds")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)


## A gamepad axis accept input held at the app focus loss, the background entry or the gamepad disconnection gets no
## release event: its next press is a press of its own, judged by the state before it.
func test_accept_axis_pressed_again_after_a_release_with_no_event_is_judged_at_the_new_press() -> void:
	_add_accept(JOY_BUTTON_X)
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	InputCoreDev.inject_gamepad_connection(0, true)
	var releases: Array[Callable] = [
		get_tree().root.propagate_notification.bind(NOTIFICATION_APPLICATION_FOCUS_OUT),
		UnitTestCore.advance_clock.bind(0, true),
		InputCoreDev.inject_gamepad_connection.bind(0, false),
	]
	var labels: PackedStringArray = ["the app focus loss", "the background entry", "the gamepad disconnection"]
	for i: int in releases.size():
		await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8)])
		releases[i].call()
		InputCoreDev.inject_gamepad_connection(0, true)
		_refocus()
		clicks.clear()
		await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
				_axis(JOY_AXIS_TRIGGER_RIGHT, 0.9), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
		assert_eq(clicks, PackedStringArray(["second", "second"]), labels[i])
		InputCore.inject_action(&"cutscene_advance", false, 0.0)
		await UnitTestCore.wait_frames(1)
	InputCore.reset_pad_buttons()


## An input cancel releases the held axis source with no release event, as the app focus loss does, and the next value
## event of the axis presses it again: the block start check and `InputCore.cancel_input`.
func test_accept_axis_pressed_again_after_an_input_cancel_is_judged_at_the_new_press() -> void:
	_add_accept(JOY_BUTTON_X)
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	InputCoreDev.inject_gamepad_connection(0, true)
	var labels: PackedStringArray = ["the block start check", "InputCore.cancel_input"]
	for i: int in labels.size():
		await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8)])
		var count: int = InputCore.get_cancel_count()
		if i == 0:
			var token: int = InputBlockCore.block("ui")
			await UnitTestCore.wait_frames(2)
			assert_true(InputBlockCore.unblock(token))
			await UnitTestCore.wait_frames(2)
		else:
			InputCore.cancel_input()
		assert_eq(InputCore.get_cancel_count(), count + 1, labels[i])
		_refocus()
		clicks.clear()
		await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
				_axis(JOY_AXIS_TRIGGER_RIGHT, 0.9), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
		assert_eq(clicks, PackedStringArray(["second", "second"]), labels[i])
		InputCore.inject_action(&"cutscene_advance", false, 0.0)
		await UnitTestCore.wait_frames(1)
	InputCore.reset_pad_buttons()


## An axis value event in the blocked state after the input cancel of the block start check presses no source, so it is
## not a press: the next value event after the block presses the source again and is judged at that new press.
func test_accept_axis_value_change_in_the_blocked_state_is_not_a_press() -> void:
	await _assert_blocked_axis_value_change_is_not_a_press(null)


## An axis value event in the blocked state is not a press when the block passes an action that does not have the axis
## direction in its binding: the block stage of `InputCore` passes no action that the event presses.
func test_accept_axis_value_change_passing_an_action_without_the_axis_binding_is_not_a_press() -> void:
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [&"cutscene_skip"]
	await _assert_blocked_axis_value_change_is_not_a_press(pass_list)


## An axis value event in the blocked state is not a press when the block passes only `back` and the axis direction is
## in the binding of `back` and of a button action: the world stage of `InputCore` presses no source for `back`.
func test_accept_axis_value_change_passing_only_back_is_not_a_press() -> void:
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [&"back"]
	await _assert_blocked_axis_value_change_is_not_a_press(pass_list, true)


## An axis press event in the blocked state that the block stage of `InputCore` passes to an action presses the source
## of that action, so it is a press of its own and is judged by the state before it, as out of the blocked state.
func test_accept_axis_press_passed_through_the_block_is_a_press() -> void:
	_add_accept(JOY_BUTTON_X)
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	InputCoreDev.inject_gamepad_connection(0, true)
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [&"cutscene_advance"]
	var token: int = InputBlockCore.block("ui", pass_list)
	await UnitTestCore.wait_frames(2)
	_refocus()
	clicks.clear()
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "the press passed through the block")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	assert_true(InputBlockCore.unblock(token))
	InputCore.reset_pad_buttons()


## Whether the accept input is a binding of the action follows the `InputCore` binding, not the input map.
func test_accept_input_binding_follows_the_input_core_binding() -> void:
	_add_accept(JOY_BUTTON_X)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["x"])))
	await _inject_early([_pad(JOY_BUTTON_A, true), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_A, false), InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "an input map binding that is not an InputCore binding")
	await _inject_early([_pad(JOY_BUTTON_X, true), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", false, 0.0)])
	assert_eq(clicks.size(), 3, "an InputCore binding that is not an input map binding")
	assert_eq(ui_sounds, 3)
	InputCore.reset_pad_buttons()


func test_back_or_unknown_action_is_refused() -> void:
	assert_true(await start())
	for action: String in PackedStringArray(["back", "not_an_action"]):
		var button: Button = Button.new()
		var ui_button: UIButton = UIButton.new()
		ui_button.action = action
		ui_button.set_on_click(click_of(action))
		button.add_child(ui_button)
		UICore.get_layer(UICore.UILayer.SCENE_UI).add_child(button)
		assert_eq(errors(), 1, action)
		assert_eq(ui_button.get_action(), "", action)
	await advance(CLICK_INTERVAL_MS)
	await press_back()
	assert_eq(clicks.size(), 0, "back input does not click")


func test_click_before_init_is_dropped() -> void:
	assert_true(await start(false))
	var button: Button = Button.new()
	var ui_button: UIButton = UIButton.new()
	ui_button.set_on_click(click_of("early"))
	button.add_child(ui_button)
	add_child_autofree(button)
	button.pressed.emit()
	assert_eq(clicks.size(), 0)
	assert_eq(errors(), 1)


func test_clicks_while_game_time_is_paused() -> void:
	assert_true(await start())
	var call: CALL = CALL.new()
	TimeCore.set_paused(true)
	call.open_popup(POPUP_TWEEN)
	await finish(call)
	assert_true(call.ok, "the open tween ends in the pause")
	var button: Button = named_button(popup_of(POPUP_TWEEN), "First")
	ui_button_of(button).set_on_click(click_of("paused"))
	await tap_control(button)
	assert_eq(clicks, PackedStringArray(["paused"]))
	TimeCore.set_paused(false)


## Opens `POPUP_FOCUS` with no click interval and the gamepad focus on its `Second`, a `UIButton` of the action
## `cutscene_advance` (gamepad button `a`) whose clicks are `"second"`.
func _focus_action_button() -> void:
	set_int("UICore.buttonClickIntervalMs", 0)
	assert_true(await start())
	assert_true(await UICore.open_popup(POPUP_FOCUS, null, Callable()) == UICore.PopupOpenResult.OPENED)
	var button: Button = named_button(popup_of(POPUP_FOCUS), "Second")
	var ui_button: UIButton = ui_button_of(button)
	button.remove_child(ui_button)
	ui_button.action = "cutscene_advance"
	button.add_child(ui_button)
	ui_button.set_on_click(click_of("second"))
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), button, "the focus element")


## With the accept trigger in the binding of `cutscene_advance`, holds the trigger into a block of `pass_list`, changes
## its value in the blocked state, then checks that the value change was no click and no press, so the first value event
## after the block is judged at its new press. `back_bound` adds the trigger to the binding of `back` after the trigger
## is held, so that no rising value event calls the back handler.
func _assert_blocked_axis_value_change_is_not_a_press(pass_list: BlockPassList, back_bound: bool = false) -> void:
	_add_accept(JOY_BUTTON_X)
	_add_accept_axis(JOY_AXIS_TRIGGER_RIGHT)
	await _focus_action_button()
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", PackedStringArray(["trigger_right+"])))
	InputCoreDev.inject_gamepad_connection(0, true)
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.8)])
	if back_bound:
		assert_true(InputCore.set_pad_buttons(&"back", PackedStringArray(["trigger_right+"])))
	var count: int = InputCore.get_cancel_count()
	var token: int = InputBlockCore.block("ui", pass_list)
	await UnitTestCore.wait_frames(2)
	assert_eq(InputCore.get_cancel_count(), count + 1, "the block start check")
	clicks.clear()
	await _inject_early([_axis(JOY_AXIS_TRIGGER_RIGHT, 0.85)])
	assert_eq(clicks, PackedStringArray(), "no click in the blocked state")
	assert_false(InputCore.is_pressed(&"cutscene_advance"), "no press in the blocked state")
	assert_true(InputBlockCore.unblock(token))
	await UnitTestCore.wait_frames(2)
	_refocus()
	clicks.clear()
	await _inject_early([_pad(JOY_BUTTON_X, false), InputCore.inject_action.bind(&"cutscene_advance", true, 1.0),
			_axis(JOY_AXIS_TRIGGER_RIGHT, 0.9), _axis(JOY_AXIS_TRIGGER_RIGHT, 0.0)])
	assert_eq(clicks, PackedStringArray(["second", "second"]), "the press after the block")
	InputCore.inject_action(&"cutscene_advance", false, 0.0)
	InputCore.reset_pad_buttons()


## Takes the focus off the focus element and gives it back, so that the engine button drops an accept press with no
## release.
func _refocus() -> void:
	var button: Control = focus_owner()
	button.release_focus()
	button.grab_focus()


## Calls `steps` in order in one process callback after `InputCore` and before `UICore`, then waits until a pending
## accept click is stamped.
func _inject_early(steps: Array[Callable]) -> void:
	var early: LATE_INPUT = LATE_INPUT.new()
	early.process_priority = -1
	add_child_autofree(early)
	early.steps = steps
	await UnitTestCore.wait_frames(1)
	assert_true(early.done, "the input is injected before the UICore process callback")
	await UnitTestCore.wait_frames(2)


## A device input of gamepad button `button`.
func _pad(button: JoyButton, pressed: bool) -> Callable:
	var event: InputEventJoypadButton = InputEventJoypadButton.new()
	event.button_index = button
	event.pressed = pressed
	return InputCoreDev.inject_device_input.bind(event)


## A device input of gamepad axis `axis` at `value`.
func _axis(axis: JoyAxis, value: float) -> Callable:
	var event: InputEventJoypadMotion = InputEventJoypadMotion.new()
	event.axis = axis
	event.axis_value = value
	return InputCoreDev.inject_device_input.bind(event)


## Adds the positive direction of gamepad axis `axis` to the engine accept input until the test ends.
func _add_accept_axis(axis: JoyAxis) -> void:
	var event: InputEventJoypadMotion = InputEventJoypadMotion.new()
	event.axis = axis
	event.axis_value = 1.0
	event.device = -1
	InputMap.action_add_event(&"ui_accept", event)
	_added_accepts.append(event)


## Adds gamepad button `button` to the engine accept input until the test ends.
func _add_accept(button: JoyButton) -> void:
	var event: InputEventJoypadButton = InputEventJoypadButton.new()
	event.button_index = button
	event.device = -1
	InputMap.action_add_event(&"ui_accept", event)
	_added_accepts.append(event)
