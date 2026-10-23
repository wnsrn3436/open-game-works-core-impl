extends InputCoreTestCase
## Block stage, block start check and the debug stage.

const AREA: Rect2 = Rect2(1100.0, 500.0, 200.0, 200.0)
const OUTSIDE: Vector2 = Vector2(1600.0, 600.0)


func test_discarded_input_changes_nothing_but_the_device() -> void:
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	var token: int = block_all()
	await run_frame_checks()
	start_wait_key()
	recorder.clear()
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(recorder.count("button"), 0, "the UI element gets nothing")
	assert_eq(InputCore.get_device(), InputCore.InputDevice.TOUCH, "device detection uses the input")
	key(KEY_ESCAPE, true)
	assert_eq(recorder.count("back"), 0)
	key(KEY_J, true)
	InputCore.inject_action(&"fire", true, 1.0)
	assert_false(InputCore.is_pressed(&"jump"))
	assert_false(InputCore.is_pressed(&"fire"))
	assert_eq(key_result, PENDING, "wait_key goes on")
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	unblock(token)
	key(KEY_J, false)
	key(KEY_ESCAPE, false)
	InputCore.cancel_wait_key()


func test_input_a_block_passes_is_handled_as_without_a_block() -> void:
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	var token: int = block_with([&"jump"], [button])
	key(KEY_J, true)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"jump"))
	InputCore.inject_action(&"jump", false, 0.0)
	key(KEY_J, false)
	assert_false(InputCore.is_pressed(&"jump"))
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(recorder.count("button"), 1)
	unblock(token)


func test_focus_input_goes_to_the_focused_pass_list_element() -> void:
	InputMap.action_add_event(&"ui_accept", pad_button_event(JOY_BUTTON_A))
	var first: Button = make_button(AREA)
	var second: Button = make_button(Rect2(1100.0, 800.0, 200.0, 100.0))
	first.focus_neighbor_bottom = first.get_path_to(second)
	assert_eq(first.pressed.connect(recorder.on_button_pressed), OK)
	first.grab_focus()
	recorder.back_result = true
	InputCore.set_back_handler(recorder.on_back)
	var token: int = block_with([], [first])
	await run_frame_checks()
	start_wait_pad_button()
	pad_button(JOY_BUTTON_A, true)
	pad_button(JOY_BUTTON_A, false)
	assert_eq(recorder.count("button"), 1, "the accept input reaches the focused element")
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	assert_eq(pad_result, PENDING, "wait_pad_button goes on")
	pad_button(JOY_BUTTON_B, true)
	pad_button(JOY_BUTTON_B, false)
	assert_eq(recorder.count("back"), 0)
	pad_button(JOY_BUTTON_DPAD_DOWN, true)
	pad_button(JOY_BUTTON_DPAD_DOWN, false)
	assert_eq(get_viewport().gui_get_focus_owner(), second, "the direction input moves the focus")
	assert_eq(second.pressed.connect(recorder.on_button_pressed), OK)
	pad_button(JOY_BUTTON_A, true)
	pad_button(JOY_BUTTON_A, false)
	assert_eq(recorder.count("button"), 1, "the focus outside the pass list is discarded")
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	unblock(token)
	InputCore.cancel_wait_key()


func test_block_stage_rules() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	var token: int = block_with([&"jump"], [control])
	touch(0, true, OUTSIDE)
	touch(0, false, OUTSIDE)
	assert_eq(recorder.count("pointer"), 0, "a press outside the pass list element is discarded")
	touch(1, true, CENTER)
	touch(1, false, CENTER)
	assert_eq(recorder.count("pointer"), 2)
	mouse_button(MOUSE_BUTTON_RIGHT, true, OUTSIDE)
	assert_false(InputCore.get_mouse_position().ok, "a mouse button outside is discarded")
	mouse_button(MOUSE_BUTTON_RIGHT, true, CENTER)
	assert_true(InputCore.get_mouse_position().ok)
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"jump"))
	key(KEY_F, true)
	assert_false(InputCore.is_pressed(&"fire"))
	start_wait_key()
	key(KEY_Z, true)
	assert_eq(key_result, PENDING, "an input without an action is discarded in the blocked state")
	unblock(token)
	key(KEY_Z, false)
	key(KEY_Z, true)
	assert_eq(key_result, "Z")


func test_pointer_move_and_release_follow_the_passed_pointer() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	var token: int = block_with([], [control])
	touch(0, true, CENTER)
	drag(0, OUTSIDE)
	touch(0, false, OUTSIDE)
	assert_eq(recorder.count("pointer"), 2, "the release outside reaches the UI stage")
	assert_eq(control.touch_moves, 1, "the move outside reaches the UI stage")
	assert_eq(control.touch_releases, 1)
	recorder.clear()
	touch(1, true, OUTSIDE)
	drag(1, CENTER)
	touch(1, false, CENTER)
	assert_eq(recorder.count("pointer"), 0, "a pointer pressed outside stays discarded")
	assert_eq(control.touch_moves, 1)
	assert_eq(control.touch_releases, 1)
	unblock(token)
	touch(2, true, CENTER)
	assert_eq(recorder.count("pointer"), 1)
	token = block_with([], [control])
	drag(2, CENTER + Vector2(10, 10))
	touch(2, false, CENTER + Vector2(10, 10))
	assert_eq(recorder.count("pointer"), 1, "a pointer pressed before the block started is discarded")
	assert_eq(control.touch_moves, 1)
	unblock(token)


func test_inject_with_a_passed_pointer_passes_the_block() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	var token: int = block_with([], [control])
	touch(0, true, CENTER)
	InputCore.inject_action(&"fire", true, 1.0, 0)
	assert_true(InputCore.is_pressed(&"fire"), "pointer 0 is a passed pointer")
	InputCore.inject_action(&"move_left", true, 1.0, 5)
	assert_false(InputCore.is_pressed(&"move_left"), "pointer 5 is not pressed")
	touch(0, false, CENTER)
	InputCore.inject_action(&"jump", true, 1.0, 0)
	assert_false(InputCore.is_pressed(&"jump"), "pointer 0 is released")
	unblock(token)
	token = block_with([&"jump"], [])
	InputCore.inject_action(&"jump", true, 1.0, 7)
	assert_true(InputCore.is_pressed(&"jump"), "InputBlockCore.pass_action decides for a pointer that is not passed")
	unblock(token)


func test_inject_of_the_ui_stage_passes_while_the_release_is_dispatched() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	control.pointer_action = &"fire"
	var token: int = block_with([], [control])
	touch(0, true, CENTER)
	assert_true(InputCore.is_pressed(&"fire"), "the inject of the press has the passed pointer")
	touch(0, false, CENTER)
	assert_false(InputCore.is_pressed(&"fire"), "the inject of the release has the releasing pointer")
	unblock(token)


func test_released_pointer_slot_is_freed_after_the_dispatch_of_the_release() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	control.pointer_action = &"fire"
	var token: int = block_with([], [control])
	engine_touch(0, true, CENTER)
	engine_touch(0, false, CENTER)
	assert_eq(control.touch_releases, 1)
	assert_false(InputCore.is_pressed(&"fire"), "the UI element took the release and its inject passed")
	await next_frame()
	InputCore.inject_action(&"jump", true, 1.0, 0)
	assert_false(InputCore.is_pressed(&"jump"), "the next frame freed the slot the UI element's release kept")
	engine_touch(1, true, CENTER)
	engine_touch(1, false, CENTER)
	key(KEY_K, true)
	InputCore.inject_action(&"jump", true, 1.0, 1)
	assert_false(InputCore.is_pressed(&"jump"), "the next input freed the slot the UI element's release kept")
	key(KEY_K, false)
	control.mouse_filter = Control.MOUSE_FILTER_PASS
	engine_touch(2, true, CENTER)
	engine_touch(2, false, CENTER)
	assert_eq(control.touch_releases, 3)
	assert_false(InputCore.is_pressed(&"fire"), "the inject of the release passed")
	InputCore.inject_action(&"jump", true, 1.0, 2)
	assert_false(InputCore.is_pressed(&"jump"), "the world stage freed the slot of the release no UI element took")
	unblock(token)


func test_release_a_ui_element_took_ends_at_the_next_physics_frame() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	var token: int = block_with([], [control])
	var probe: InputCoreTestFrameProbe = keep(InputCoreTestFrameProbe.new()) as InputCoreTestFrameProbe
	get_tree().root.add_child(probe)
	probe.physics = true
	probe.action = &"jump"
	var ticks: int = Engine.physics_ticks_per_second
	# Every frame has physics steps, so a physics step comes between the release and the next process callbacks.
	Engine.physics_ticks_per_second = 1000
	var checked: int = await probe_releases(probe, control, func(p: InputCoreTestFrameProbe) -> bool:
		return p.inject_process_count == p.release_process_count)
	Engine.physics_ticks_per_second = ticks
	assert_true(checked > 0, "a physics callback came between the release and the next process callbacks")
	unblock(token)


func test_release_a_ui_element_took_ends_at_the_next_process_frame() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	var token: int = block_with([], [control])
	var probe: InputCoreTestFrameProbe = keep(InputCoreTestFrameProbe.new()) as InputCoreTestFrameProbe
	get_tree().root.add_child(probe)
	probe.action = &"jump"
	var ticks: int = Engine.physics_ticks_per_second
	# Few frames have a physics step, so the next process frame alone ends the release.
	Engine.physics_ticks_per_second = 1
	var checked: int = await probe_releases(probe, control, func(p: InputCoreTestFrameProbe) -> bool:
		return p.inject_physics_frames == p.release_physics_frames)
	Engine.physics_ticks_per_second = ticks
	assert_true(checked > 0, "the next process callbacks came without a physics step after the release")
	unblock(token)


func test_debug_handler_runs_first_also_in_the_blocked_state() -> void:
	InputCoreDev.set_debug_input_handler(recorder.on_debug)
	var token: int = block_all()
	key(KEY_J, true)
	key(KEY_J, false)
	touch(0, true, CENTER)
	assert_eq(recorder.count("debug"), 3, "once for every device input")
	unblock(token)
	touch(0, false, CENTER)
	recorder.debug_result = true
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()
	key(KEY_J, true)
	touch(1, true, CENTER)
	touch(1, false, CENTER)
	assert_false(InputCore.is_pressed(&"jump"), "a handled input changes no later stage")
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE)
	assert_eq(recorder.count("tap"), 0)
	assert_eq(recorder.count("debug"), 3)
	recorder.debug_result = false
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"jump"))


func test_block_start_cancels_the_pressed_action() -> void:
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"jump"))
	var token: int = block_all()
	await run_frame_checks()
	assert_false(InputCore.is_pressed(&"jump"), "the first frame of the blocked state cancels the input")
	assert_eq(InputCore.get_cancel_count(), 1)
	key(KEY_J, false)
	assert_false(InputCore.is_pressed(&"jump"))
	unblock(token)
	key(KEY_J, true)
	token = block_all()
	key(KEY_D, true)
	assert_false(InputCore.is_pressed(&"jump"), "the first block stage of the blocked state cancels the input")
	assert_eq(InputCore.get_cancel_count(), 2)
	unblock(token)


## A touch input through engine input processing alone, without the end of `inject_device_input`.
func engine_touch(index: int, pressed: bool, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = to_window(position)
	Input.parse_input_event(event)
	Input.flush_buffered_events()


## Releases of pointers the UI element took, each run by `probe` at the end of a frame and followed by its inject. For
## each one `counts` accepts (the probe callback came before the frame signal under test and no other one), checks
## that the release processing had ended. Returns how many it checked.
func probe_releases(probe: InputCoreTestFrameProbe, control: InputCoreTestControl, counts: Callable) -> int:
	var checked: int = 0
	for index: int in 10:
		engine_touch(index, true, CENTER)
		var releases: int = control.touch_releases
		probe.pointer_id = index
		probe.start(engine_touch.bind(index, false, CENTER))
		for frame: int in 10:
			if probe.done:
				break
			await next_frame()
		assert_true(probe.done, "the probe injected")
		assert_eq(control.touch_releases, releases + 1, "the UI element took the release")
		if probe.done and counts.call(probe):
			checked += 1
			assert_false(probe.pressed, "the release processing of pointer %d had ended" % index)
	return checked


func test_axis_input_checks_only_the_actions_it_presses_or_releases() -> void:
	var token: int = block_with([&"move_right"], [])
	pad_axis(JOY_AXIS_LEFT_X, 0.8)
	assert_true(InputCore.is_pressed(&"move_right"), "move_left is not pressed or released by a positive value")
	assert_almost_eq(InputCore.get_strength(&"move_right"), 0.8, 0.0001)
	pad_axis(JOY_AXIS_LEFT_X, 0.4)
	assert_almost_eq(InputCore.get_strength(&"move_right"), 0.4, 0.0001)
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	assert_false(InputCore.is_pressed(&"move_right"), "the release of move_right passes")
	pad_axis(JOY_AXIS_LEFT_X, -0.8)
	assert_false(InputCore.is_pressed(&"move_left"), "a press of move_left does not pass")
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	unblock(token)
	token = block_with([&"move_left"], [])
	pad_axis(JOY_AXIS_LEFT_X, -0.6)
	assert_almost_eq(InputCore.get_strength(&"move_left"), 0.6, 0.0001)
	pad_axis(JOY_AXIS_LEFT_X, 0.0)
	assert_false(InputCore.is_pressed(&"move_left"))
	pad_axis(JOY_AXIS_LEFT_X, 0.7)
	assert_false(InputCore.is_pressed(&"move_right"), "a press of move_right does not pass")
	unblock(token)


func test_discarded_key_release_releases_the_pressed_source() -> void:
	var token: int = block_with([&"jump"], [])
	key(KEY_J, true)
	assert_true(InputCore.is_pressed(&"jump"))
	var second: int = block_all()
	key(KEY_J, false)
	assert_false(InputCore.is_pressed(&"jump"), "the discarded release releases the source")
	await input_frame()
	assert_true(InputCore.is_just_released(&"jump"))
	unblock(second)
	unblock(token)
	assert_false(InputCore.is_pressed(&"jump"), "the action is not pressed after the blocks end")
	assert_eq(InputCore.get_cancel_count(), 1, "only the first block cancels the input")


func test_discarded_mouse_button_release_releases_the_pressed_source() -> void:
	assert_true(InputCore.set_keys(&"fire", PackedStringArray(["mouse_right"])))
	var control: InputCoreTestControl = make_control(AREA)
	control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var token: int = block_with([], [control])
	mouse_button(MOUSE_BUTTON_RIGHT, true, CENTER)
	assert_true(InputCore.is_pressed(&"fire"), "the press in the pass list element passes")
	InputCoreDev.set_test_device(InputCore.InputDevice.GAMEPAD)
	mouse_button(MOUSE_BUTTON_RIGHT, false, OUTSIDE)
	assert_false(InputCore.is_pressed(&"fire"), "the release outside is discarded but releases the source")
	assert_eq(InputCore.get_device(), InputCore.InputDevice.KEYBOARD_MOUSE, "device detection uses the release")
	unblock(token)
	assert_false(InputCore.is_pressed(&"fire"), "the action is not pressed after the block ends")


func test_discarded_axis_input_releases_the_pressed_direction() -> void:
	var token: int = block_with([&"move_left"], [])
	pad_axis(JOY_AXIS_LEFT_X, -0.8)
	assert_true(InputCore.is_pressed(&"move_left"))
	pad_axis(JOY_AXIS_LEFT_X, 0.8)
	assert_false(InputCore.is_pressed(&"move_right"), "a press of move_right does not pass")
	assert_false(InputCore.is_pressed(&"move_left"), "the discarded input releases the pressed direction")
	unblock(token)
	assert_false(InputCore.is_pressed(&"move_left"), "the action is not pressed after the block ends")
	assert_false(InputCore.is_pressed(&"move_right"))
	pad_axis(JOY_AXIS_LEFT_X, 0.0)


func test_discarded_inject_release_releases_the_pressed_inject_source() -> void:
	var token: int = block_with([&"fire"], [])
	InputCore.inject_action(&"fire", true, 1.0)
	assert_true(InputCore.is_pressed(&"fire"))
	var second: int = block_all()
	InputCore.inject_action(&"fire", false, 0.0)
	assert_false(InputCore.is_pressed(&"fire"), "the discarded release releases the inject source")
	InputCore.inject_action(&"fire", true, 1.0)
	assert_false(InputCore.is_pressed(&"fire"), "a discarded press changes nothing")
	unblock(second)
	unblock(token)
	assert_false(InputCore.is_pressed(&"fire"), "the action is not pressed after the blocks end")


func test_key_of_a_passed_and_a_discarded_action_goes_to_the_passed_action_only() -> void:
	assert_true(InputCore.set_keys(&"jump", PackedStringArray(["J", "Space"])), "jump and cutscene_advance share Space")
	var token: int = block_with([&"cutscene_advance", &"cutscene_skip", &"back"], [])
	await run_frame_checks()
	key(KEY_SPACE, true)
	await input_frame()
	assert_true(InputCore.is_just_pressed(&"cutscene_advance"))
	assert_false(InputCore.is_pressed(&"jump"))
	assert_false(InputCore.is_just_pressed(&"jump"))
	key(KEY_SPACE, false)
	assert_false(InputCore.is_pressed(&"cutscene_advance"))
	assert_false(InputCore.is_just_released(&"jump"), "jump was never pressed")
	unblock(token)


func test_pad_button_of_back_and_a_discarded_action_calls_only_the_back_handler() -> void:
	recorder.back_result = false
	InputCore.set_back_handler(recorder.on_back)
	var token: int = block_with([&"back"], [])
	await run_frame_checks()
	pad_button(JOY_BUTTON_B, true)
	await input_frame()
	assert_eq(recorder.count("back"), 1, "jump and back share b")
	assert_false(InputCore.is_pressed(&"jump"), "the back handler gave false, and jump is not a passed action")
	assert_false(InputCore.is_just_pressed(&"jump"))
	pad_button(JOY_BUTTON_B, false)
	unblock(token)
	pad_button(JOY_BUTTON_B, true)
	assert_eq(recorder.count("back"), 2)
	assert_true(InputCore.is_pressed(&"jump"), "without the block the false of the back handler presses jump")
	pad_button(JOY_BUTTON_B, false)


## A test screen whose window size is not the real window size: `pass_position` gets the input's game position in window
## pixels of the test screen, so a press on the pass list element passes and one beside it does not.
func test_pass_position_under_a_test_screen() -> void:
	var real: Vector2i = get_tree().root.size
	set_screen(Vector2i(1920, 1080), Vector2i(real.x * 3 + 7, real.y * 2 + 5))
	await next_frame()
	var visible: Rect2 = ResolutionCore.get_visible_game_area()
	var rect: Rect2 = Rect2(visible.get_center() + Vector2(100, 50), Vector2(80, 40))
	# the root canvas is the window area in game coordinates
	var control: InputCoreTestControl = keep(InputCoreTestControl.new()) as InputCoreTestControl
	control.position = rect.position
	control.size = rect.size
	get_tree().root.add_child(control)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	var token: int = block_with([], [control])
	await run_frame_checks()
	recorder.clear()
	touch(0, true, rect.get_center())
	touch(0, false, rect.get_center())
	assert_eq(control.touch_presses, 1, "the press inside reaches the element (real window %s, test window %s)"
			% [real, ResolutionCore.get_window_size()])
	assert_eq(recorder.count("pointer"), 2)
	for outside: Vector2 in [rect.position - Vector2(10, 10), rect.end + Vector2(10, 10),
			Vector2(rect.end.x + 10, rect.get_center().y)]:
		touch(1, true, outside)
		touch(1, false, outside)
	assert_eq(control.touch_presses, 1, "the presses outside are discarded")
	assert_eq(recorder.count("pointer"), 2)
	unblock(token)


## A content process callback of frame F blocks while a key presses `jump`: the block start check of the core node's
## process callback of F+1, before the content's, cancels the input.
func test_block_from_a_content_process_callback_releases_in_the_next_frame() -> void:
	key(KEY_J, true)
	await input_frame()
	assert_true(InputCore.is_pressed(&"jump"))
	var content: _ContentProcess = keep(_ContentProcess.new()) as _ContentProcess
	content.test = self
	get_tree().root.add_child(content)
	while content.results.size() < 3:
		await get_tree().process_frame
	assert_eq(content.results, [false, true, false], "is_just_released in F after the block, in F+1 and in F+2")
	assert_eq(content.frames[1], content.frames[0] + 1)
	assert_eq(content.frames[2], content.frames[0] + 2)
	assert_eq(InputCore.get_cancel_count(), 1)
	unblock(content.token)
	key(KEY_J, false)


## A content node: its process callback comes after the one of the InputCore core node. In its first one (frame F) it
## blocks, then it records `is_just_released(&"jump")` in F, F+1 and F+2.
class _ContentProcess:
	extends Node

	var test: InputCoreTestCase = null
	var token: int = -1
	var results: Array[bool] = []
	var frames: Array[int] = []

	func _init() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS

	func _process(_delta: float) -> void:
		if results.size() >= 3:
			return
		if token < 0:
			token = test.block_all()
		results.append(InputCore.is_just_released(&"jump"))
		frames.append(Engine.get_process_frames())


func test_block_start_cancels_the_drag_and_the_pinch_of_pressed_pointers() -> void:
	for check_by_input: bool in [false, true]:
		InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
		InputCore.set_pinch_enabled(true)
		touch(0, true, CENTER)
		touch(1, true, CENTER + Vector2(200, 0))
		touch(2, true, CENTER + Vector2(0, 200))
		drag(2, CENTER + Vector2(50, 200))
		assert_eq(recorder.pinch_phases(), [InputCore.GesturePhase.START])
		assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START])
		recorder.clear()
		var token: int = block_all()
		if check_by_input:
			key(KEY_K, true)
			key(KEY_K, false)
		else:
			await run_frame_checks()
		assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.CANCEL], "first block stage" if check_by_input
				else "first frame")
		assert_eq(recorder.pinch_phases(), [InputCore.GesturePhase.CANCEL])
		advance(LONG_PRESS_MS)
		await run_frame_checks()
		drag(2, CENTER + Vector2(300, 200))
		touch(0, false, CENTER)
		touch(1, false, CENTER + Vector2(200, 0))
		touch(2, false, CENTER + Vector2(300, 200))
		assert_eq(recorder.count("long_press"), 0)
		assert_eq(recorder.count("drag"), 1, "the releases in the blocked state make no gesture event")
		assert_eq(recorder.count("pinch"), 1)
		for kind: String in ["tap", "swipe"]:
			assert_eq(recorder.count(kind), 0, kind)
		unblock(token)
		recorder.clear()


## The engine sends the mouse input it makes from a touch before that touch, so the mouse release is the first input
## of the block stage after the block starts.
func test_a_block_started_after_a_touch_press_keeps_the_mouse_release_made_from_it_off_the_element() -> void:
	var button: Button = make_button(AREA)
	assert_eq(button.pressed.connect(recorder.on_button_pressed), OK)
	var passed: InputCoreTestControl = make_control(Rect2(OUTSIDE, Vector2(100.0, 100.0)))
	touch(0, true, AREA.get_center())
	touch(0, false, AREA.get_center())
	assert_eq(recorder.count("button"), 1, "without a block the touch clicks the element")
	touch(0, true, AREA.get_center())
	var token: int = block_with([], [passed])
	touch(0, false, AREA.get_center())
	assert_eq(InputCore.get_cancel_count(), 1, "the release runs the block start check")
	assert_eq(recorder.count("button"), 1, "the element outside the pass list is not clicked")
	unblock(token)


func test_a_block_started_after_a_touch_press_discards_the_mouse_moves_made_from_it() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	var passed: InputCoreTestControl = make_control(Rect2(OUTSIDE, Vector2(100.0, 100.0)))
	touch(0, true, AREA.get_center())
	drag(0, AREA.get_center() + Vector2(5, 0))
	var motions: int = control.mouse_motions
	assert_gt(motions, 0, "without a block the element gets the mouse move made from the touch")
	var token: int = block_with([], [passed])
	drag(0, AREA.get_center() + Vector2(10, 0))
	assert_eq(InputCore.get_cancel_count(), 1, "the move runs the block start check")
	assert_eq(control.mouse_motions, motions, "the element outside the pass list gets no mouse move")
	touch(0, false, AREA.get_center() + Vector2(10, 0))
	unblock(token)
