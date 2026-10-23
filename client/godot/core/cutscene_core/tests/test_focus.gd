extends "res://core/cutscene_core/tests/support/cutscene_test_case.gd"
## View focus with a gamepad: the focus element of each state, accept input and direction input.

const LATE_INPUT := preload("res://core/cutscene_core/tests/support/cutscene_test_late_input.gd")

## Gamepad button `a` as the engine accept input. The engine default `ui_accept` has no gamepad button.
var _pad_accept: InputEventJoypadButton = null
## Gamepad axis directions a test added to `ui_accept`.
var _axis_accepts: Array[InputEvent] = []


func before_each() -> void:
	super()
	_pad_accept = null
	_axis_accepts = []
	for event: InputEvent in InputMap.action_get_events(&"ui_accept"):
		var pad: InputEventJoypadButton = event as InputEventJoypadButton
		if pad != null and pad.button_index == JOY_BUTTON_A:
			return
	_pad_accept = InputEventJoypadButton.new()
	_pad_accept.button_index = JOY_BUTTON_A
	_pad_accept.device = -1
	InputMap.action_add_event(&"ui_accept", _pad_accept)


func after_each() -> void:
	if _pad_accept != null:
		InputMap.action_erase_event(&"ui_accept", _pad_accept)
	for event: InputEvent in _axis_accepts:
		InputMap.action_erase_event(&"ui_accept", event)
	super()


func focus_owner() -> Control:
	return get_tree().root.gui_get_focus_owner()


## Starts the modules with the gamepad as the input device. Async.
func start_gamepad() -> bool:
	var started: bool = await start()
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	await UnitTestCore.wait_frames(2)
	return started


func test_the_advance_button_has_the_focus_during_a_line_and_accept_is_one_advance_input() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), view().advance_button)
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(1)
	assert_eq(CutsceneCore._next, 2, "one advance input ends one line")
	assert_true(line_running())
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


## Puts device input `event` in from a `SceneTree.process_frame` handler of the next frame, before its process
## callbacks, as `QACore` puts in automation channel device inputs. Async: ends in that frame, before its process
## callbacks.
func inject_at_frame_start(event: InputEvent) -> void:
	get_tree().process_frame.connect(InputCoreDev.inject_device_input.bind(event), CONNECT_ONE_SHOT)
	await get_tree().process_frame


func test_a_device_accept_input_at_a_frame_start_is_one_advance_input() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), view().advance_button)
	var press: InputEventJoypadButton = InputEventJoypadButton.new()
	press.button_index = JOY_BUTTON_A
	press.pressed = true
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	await inject_at_frame_start(press)
	await inject_at_frame_start(release)
	await UnitTestCore.wait_frames(2)
	assert_eq(CutsceneCore._next, 2, "one accept input at a frame start ends one line")
	assert_true(line_running())
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_a_device_accept_press_and_release_in_one_batch_after_the_frame_code_is_one_advance_input() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), view().advance_button)
	var next: int = CutsceneCore._next
	var press: InputEventJoypadButton = _pad_event(JOY_BUTTON_A)
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	var late: LATE_INPUT = LATE_INPUT.new()
	add_child_autofree(late)
	late.steps = [InputCoreDev.inject_device_input.bind(press), InputCoreDev.inject_device_input.bind(release)]
	await UnitTestCore.wait_frames(1)
	assert_true(late.done, "the input is injected after the process callbacks of the frame")
	await UnitTestCore.wait_frames(3)
	assert_eq(CutsceneCore._next, next + 1, "one press and release after the process callbacks ends one line")
	assert_true(line_running())
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


## With `ui_accept` having the directions of `accept_values` on `axis` and `binding` as the gamepad button binding of
## `cutscene_advance`, puts in `axis` at each of `values` in order, each at a frame start with frames between, on the
## focused advance button. The last value releases the axis and clicks the button. The advance inputs of each value.
## Async.
func axis_accept_advances(
	axis: JoyAxis, accept_values: Array[float], binding: PackedStringArray, values: Array[float]
) -> PackedInt32Array:
	for value: float in accept_values:
		var accept: InputEventJoypadMotion = InputEventJoypadMotion.new()
		accept.axis = axis
		accept.axis_value = value
		accept.device = -1
		InputMap.action_add_event(&"ui_accept", accept)
		_axis_accepts.append(accept)
	assert_true(await start_gamepad())
	assert_true(InputCore.set_pad_buttons(&"cutscene_advance", binding))
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	assert_eq(focus_owner(), view().advance_button)
	var clicks: Array[int] = [0]
	view().advance_button.pressed.connect(func() -> void: clicks[0] += 1)
	var advances: PackedInt32Array = PackedInt32Array()
	var next: int = CutsceneCore._next
	for value: float in values:
		var motion: InputEventJoypadMotion = InputEventJoypadMotion.new()
		motion.axis = axis
		motion.axis_value = value
		await inject_at_frame_start(motion)
		await UnitTestCore.wait_frames(3)
		advances.append(CutsceneCore._next - next)
		next = CutsceneCore._next
	assert_eq(clicks[0], 1, "the release clicks the advance button once")
	assert_true(line_running())
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)
	return advances


func test_an_accept_axis_direction_in_the_binding_released_to_zero_is_one_advance_input() -> void:
	var advances: PackedInt32Array = await axis_accept_advances(
		JOY_AXIS_TRIGGER_RIGHT, [1.0], PackedStringArray(["a", "trigger_right+"]), [1.0, 0.0]
	)
	assert_eq(advances, PackedInt32Array([1, 0]), "the press is the advance input and its release click is not")


func test_a_negative_accept_axis_direction_in_the_binding_released_to_zero_is_one_advance_input() -> void:
	var advances: PackedInt32Array = await axis_accept_advances(
		JOY_AXIS_RIGHT_X, [-1.0, 1.0], PackedStringArray(["a", "right_x-"]), [-1.0, 0.0]
	)
	assert_eq(advances, PackedInt32Array([1, 0]), "the release to 0.0 releases right_x-, which is in the binding")


func test_an_accept_axis_direction_not_in_the_binding_released_to_zero_is_one_advance_input() -> void:
	var advances: PackedInt32Array = await axis_accept_advances(
		JOY_AXIS_RIGHT_X, [1.0], PackedStringArray(["a", "right_x-"]), [1.0, 0.0]
	)
	assert_eq(advances, PackedInt32Array([0, 1]), "the release click of right_x+ is the advance input")


func test_an_accept_axis_swept_to_the_bound_direction_and_released_is_two_advance_inputs() -> void:
	var advances: PackedInt32Array = await axis_accept_advances(
		JOY_AXIS_RIGHT_X, [1.0], PackedStringArray(["a", "right_x-"]), [1.0, -1.0, 0.0]
	)
	assert_eq(advances, PackedInt32Array([0, 1, 1]),
			"the right_x- press is an advance input and the release click of the right_x+ press is another")


func test_a_negative_accept_axis_swept_to_the_bound_direction_and_released_is_two_advance_inputs() -> void:
	var advances: PackedInt32Array = await axis_accept_advances(
		JOY_AXIS_RIGHT_X, [-1.0], PackedStringArray(["a", "right_x+"]), [-1.0, 1.0, -0.1]
	)
	assert_eq(advances, PackedInt32Array([0, 1, 1]),
			"the right_x+ press is an advance input and the release click of the right_x- press is another")


func test_accept_on_the_focused_line_history_button_during_a_line_opens_the_window_and_does_not_end_the_line() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_history]")
	await UnitTestCore.wait_frames(2)
	assert_true(line_running())
	var next: int = CutsceneCore._next
	view().line_history_button.grab_focus()
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), view().line_history_button)
	assert_true(InputMap.action_has_event(&"cutscene_advance", _pad_event(JOY_BUTTON_A)), "A is cutscene_advance")
	assert_true(InputMap.action_has_event(&"ui_accept", _pad_event(JOY_BUTTON_A)), "A is ui_accept")
	var press: InputEventJoypadButton = _pad_event(JOY_BUTTON_A)
	InputCoreDev.inject_device_input(press)
	await UnitTestCore.wait_frames(2)
	assert_true(line_running(), "the cutscene_advance press is not an advance input")
	var release: InputEventJoypadButton = press.duplicate() as InputEventJoypadButton
	release.pressed = false
	InputCoreDev.inject_device_input(release)
	await UnitTestCore.wait_frames(3)
	assert_true(CutsceneCore._history_open, "the accept input is the line history button click")
	assert_true(line_running(), "the cutscene_advance press is not an advance input")
	assert_eq(CutsceneCore._next, next)
	assert_eq(CutsceneCore._history.size(), 1)
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func _pad_event(button: JoyButton) -> InputEventJoypadButton:
	var event: InputEventJoypadButton = InputEventJoypadButton.new()
	event.button_index = button
	event.pressed = true
	return event


func test_the_first_choice_button_has_the_focus_and_direction_and_accept_pick_a_choice() -> void:
	FLAGS.flag_c = true
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_choice]")
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(2)
	assert_true(choice_running())
	var shown: Array[Button] = shown_choices()
	assert_true(shown[0].disabled, "the first choice is locked")
	assert_eq(focus_owner(), shown[1], "the first choice button that is not locked")
	await press_pad(JOY_BUTTON_DPAD_DOWN)
	await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), shown[2])
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(2)
	assert_eq(CutsceneCore._picked.size(), 1)
	assert_eq(CutsceneCore._picked[0].choice, 4, "the focused choice")
	assert_eq(CutsceneCore._choice_step, 3, "its next_step")
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_locked_choice_buttons_are_not_focus_elements() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_choice]")
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(2)
	var shown: Array[Button] = shown_choices()
	assert_eq(focus_owner(), shown[1])
	for button: JoyButton in [JOY_BUTTON_DPAD_UP, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_DOWN, JOY_BUTTON_DPAD_UP]:
		await press_pad(button)
		await UnitTestCore.wait_frames(1)
		assert_ne(focus_owner(), shown[0], "locked")
		assert_ne(focus_owner(), shown[2], "locked")
	CutsceneCore._stop()
	await finish(call)
	assert_eq(errors(), 0)


func test_accept_on_the_line_history_button_opens_the_window_with_the_focus_on_the_close_button() -> void:
	assert_true(await start_gamepad())
	var call: PLAY = await play("[cut_choice_box]")
	await UnitTestCore.wait_frames(2)
	view().line_history_button.grab_focus()
	await UnitTestCore.wait_frames(1)
	if focus_owner() != view().line_history_button:
		await press_pad(JOY_BUTTON_DPAD_DOWN)
		await UnitTestCore.wait_frames(1)
	assert_eq(focus_owner(), view().line_history_button)
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(3)
	assert_true(CutsceneCore._history_open)
	assert_eq(focus_owner(), view().line_history_close_button)
	await press_pad(JOY_BUTTON_A)
	await UnitTestCore.wait_frames(2)
	assert_false(CutsceneCore._history_open)
	await tap(shown_choices()[0])
	await finish(call)
	await UnitTestCore.wait_frames(2)
	var focused: Control = focus_owner()
	assert_true(focused == null or not root().is_ancestor_of(focused), "no Cutscene view focus after playback end")
	assert_eq(errors(), 0)
