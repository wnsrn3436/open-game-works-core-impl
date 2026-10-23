extends InputCoreTestCase
## Tap, long press, drag, swipe, pinch, unusable positions and a press of a pressed pointer ID.

const RIGHT: Vector2 = Vector2(200.0, 0.0)


func before_each() -> void:
	super()
	InputCoreDev.set_test_device(InputCore.InputDevice.TOUCH)
	recorder.clear()


func test_tap() -> void:
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(MOVE_THRESHOLD, 0))
	touch(0, false, CENTER + Vector2(MOVE_THRESHOLD, 0))
	assert_eq(recorder.count("tap"), 1)
	assert_eq(recorder.of("tap")[0].pointer_id, 0)
	assert_almost_eq(recorder.of("tap")[0].position, CENTER + Vector2(MOVE_THRESHOLD, 0), Vector2(0.01, 0.01))
	assert_eq(recorder.count("drag"), 0)


func test_long_press() -> void:
	# below the threshold: the window to game round trip of a move of exactly the threshold can land over it
	var moved: Vector2 = CENTER + Vector2(MOVE_THRESHOLD * 0.6, MOVE_THRESHOLD * 0.6)
	touch(0, true, CENTER)
	drag(0, moved)
	advance(LONG_PRESS_MS - 1)
	await run_frame_checks()
	assert_eq(recorder.count("long_press"), 0)
	advance(1)
	await run_frame_checks()
	assert_eq(recorder.count("long_press"), 1)
	assert_eq(recorder.of("long_press")[0].pointer_id, 0)
	assert_almost_eq(recorder.of("long_press")[0].position, moved, Vector2(0.01, 0.01),
		"the position of the pointer moved within the threshold")
	advance(LONG_PRESS_MS)
	await run_frame_checks()
	assert_eq(recorder.count("long_press"), 1, "once per pointer")
	touch(0, false, moved)
	assert_eq(recorder.count("tap"), 0)
	assert_eq(recorder.count("drag"), 0)


func test_long_pressed_pointer_starts_a_drag() -> void:
	touch(0, true, CENTER)
	advance(LONG_PRESS_MS)
	await run_frame_checks()
	drag(0, CENTER + Vector2(50, 0))
	touch(0, false, CENTER + Vector2(50, 0))
	assert_eq(recorder.count("long_press"), 1)
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.END])


func test_drag() -> void:
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(MOVE_THRESHOLD + 10, 0))
	drag(0, CENTER + Vector2(MOVE_THRESHOLD + 20, 5))
	drag(0, CENTER + Vector2(MOVE_THRESHOLD + 25, 5))
	touch(0, false, CENTER + Vector2(MOVE_THRESHOLD + 25, 5))
	var drags: Array[InputCoreTestRecord] = recorder.of("drag")
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.MOVE,
		InputCore.GesturePhase.MOVE, InputCore.GesturePhase.END])
	for record: InputCoreTestRecord in drags:
		assert_eq(record.pointer_id, 0)
		assert_almost_eq(record.start_position, CENTER, Vector2(0.01, 0.01))
	assert_almost_eq(drags[0].delta, Vector2(MOVE_THRESHOLD + 10, 0), Vector2(0.01, 0.01), "START: from the press")
	assert_almost_eq(drags[1].delta, Vector2(10, 5), Vector2(0.01, 0.01))
	assert_almost_eq(drags[2].delta, Vector2(5, 0), Vector2(0.01, 0.01))
	assert_almost_eq(drags[3].delta, Vector2.ZERO, Vector2(0.01, 0.01))
	assert_almost_eq(drags[3].position, CENTER + Vector2(MOVE_THRESHOLD + 25, 5), Vector2(0.01, 0.01))
	assert_eq(recorder.count("tap"), 0)


func test_swipe() -> void:
	touch(0, true, CENTER)
	advance(SWIPE_MAX_MS)
	drag(0, CENTER + Vector2(SWIPE_MIN_DISTANCE, 0))
	touch(0, false, CENTER + Vector2(SWIPE_MIN_DISTANCE, 0))
	assert_eq(recorder.kinds(), PackedStringArray(["drag", "drag", "swipe"]), "the swipe follows END")
	var swipe: InputCoreTestRecord = recorder.of("swipe")[0]
	assert_eq(swipe.pointer_id, 0)
	assert_almost_eq(swipe.start_position, CENTER, Vector2(0.01, 0.01))
	assert_almost_eq(swipe.end_position, CENTER + Vector2(SWIPE_MIN_DISTANCE, 0), Vector2(0.01, 0.01))


func test_no_swipe_when_slow_or_short() -> void:
	touch(0, true, CENTER)
	advance(SWIPE_MAX_MS + 1)
	drag(0, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	touch(0, false, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	touch(1, true, CENTER)
	drag(1, CENTER + Vector2(SWIPE_MIN_DISTANCE - 1, 0))
	touch(1, false, CENTER + Vector2(SWIPE_MIN_DISTANCE - 1, 0))
	assert_eq(recorder.count("drag"), 4)
	assert_eq(recorder.count("swipe"), 0)


func test_swipe_uses_real_elapsed_time_while_game_time_is_paused() -> void:
	TimeCore.set_paused(true)
	touch(0, true, CENTER)
	advance(SWIPE_MAX_MS + 1)
	drag(0, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	touch(0, false, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	assert_eq(recorder.count("swipe"), 0)
	touch(1, true, CENTER)
	advance(SWIPE_MAX_MS)
	drag(1, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	touch(1, false, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	assert_eq(recorder.count("swipe"), 1)
	TimeCore.set_paused(false)


func test_two_pointers_tap_while_pinch_is_off() -> void:
	touch(0, true, CENTER)
	touch(1, true, CENTER + RIGHT)
	touch(0, false, CENTER)
	touch(1, false, CENTER + RIGHT)
	assert_eq(recorder.count("tap"), 2)
	assert_eq(recorder.count("pinch"), 0)


func test_pinch() -> void:
	InputCore.set_pinch_enabled(true)
	touch(0, true, CENTER)
	touch(1, true, CENTER + RIGHT)
	drag(1, CENTER + RIGHT * 2)
	drag(0, CENTER - RIGHT)
	touch(1, false, CENTER + RIGHT * 2)
	touch(0, false, CENTER - RIGHT)
	var pinches: Array[InputCoreTestRecord] = recorder.of("pinch")
	assert_eq(recorder.pinch_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.MOVE,
		InputCore.GesturePhase.MOVE, InputCore.GesturePhase.END])
	assert_almost_eq(pinches[0].center, CENTER + RIGHT * 0.5, Vector2(0.01, 0.01))
	assert_almost_eq(pinches[0].scale, 1.0, 0.0001)
	assert_almost_eq(pinches[1].center, CENTER + RIGHT, Vector2(0.01, 0.01))
	assert_almost_eq(pinches[1].scale, 2.0, 0.0001)
	assert_almost_eq(pinches[2].center, CENTER + RIGHT * 0.5, Vector2(0.01, 0.01))
	assert_almost_eq(pinches[2].scale, 3.0, 0.0001)
	for kind: String in ["tap", "long_press", "drag", "swipe"]:
		assert_eq(recorder.count(kind), 0, kind)


func test_pinch_start_cancels_the_drag_first() -> void:
	InputCore.set_pinch_enabled(true)
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(50, 0))
	touch(1, true, CENTER + RIGHT * 2)
	assert_eq(recorder.kinds(), PackedStringArray(["drag", "drag", "pinch"]))
	var cancel: InputCoreTestRecord = recorder.of("drag")[1]
	assert_eq(cancel.phase, InputCore.GesturePhase.CANCEL)
	assert_almost_eq(cancel.position, CENTER + Vector2(50, 0), Vector2(0.01, 0.01))
	assert_eq(cancel.delta, Vector2.ZERO)
	assert_eq(recorder.of("pinch")[0].phase, InputCore.GesturePhase.START)


func test_drag_cancel_subscriber_that_turns_pinch_off_stops_the_pinch() -> void:
	InputCore.set_pinch_enabled(true)
	recorder.on_drag_hook = _pinch_off_on_cancel
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(50, 0))
	touch(1, true, CENTER + RIGHT * 2)
	assert_eq(recorder.pinch_phases(), [])
	touch(1, false, CENTER + RIGHT * 2)
	assert_eq(recorder.count("tap"), 1, "the second pointer is a judge pointer without a pinch")


func test_turning_pinch_off_cancels_the_pinch() -> void:
	InputCore.set_pinch_enabled(true)
	touch(0, true, CENTER)
	touch(1, true, CENTER + RIGHT)
	drag(1, CENTER + RIGHT * 2)
	InputCore.set_pinch_enabled(false)
	var pinches: Array[InputCoreTestRecord] = recorder.of("pinch")
	assert_eq(recorder.pinch_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.MOVE,
		InputCore.GesturePhase.CANCEL])
	assert_almost_eq(pinches[2].center, pinches[1].center, Vector2(0.01, 0.01), "the previous values")
	assert_almost_eq(pinches[2].scale, pinches[1].scale, 0.0001)
	touch(0, false, CENTER)
	touch(1, false, CENTER + RIGHT * 2)
	assert_eq(recorder.count("tap"), 0, "the two pointers are not judge pointers")


func test_judge_pointer_limit() -> void:
	for i: int in MAX_JUDGE_POINTERS + 1:
		touch(i, true, CENTER + Vector2(0, 40 * i))
	for i: int in MAX_JUDGE_POINTERS + 1:
		touch(i, false, CENTER + Vector2(0, 40 * i))
	assert_eq(recorder.count("tap"), MAX_JUDGE_POINTERS)


func test_unusable_positions() -> void:
	touch(0, true, Vector2(NAN, 0.0))
	assert_eq(errors(), 1)
	touch(0, false, CENTER)
	assert_eq(recorder.count("tap") + recorder.count("drag"), 0)
	touch(1, true, CENTER)
	drag(1, CENTER + Vector2(50, 0))
	drag(1, Vector2(NAN, NAN))
	assert_eq(errors(), 1)
	assert_eq(recorder.count("drag"), 1, "no drag event for the unusable move")
	touch(1, false, Vector2(INF, 0.0))
	assert_eq(errors(), 1)
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.END])
	assert_almost_eq(recorder.of("drag")[1].position, CENTER + Vector2(50, 0), Vector2(0.01, 0.01))


func test_press_of_a_pressed_pointer_id() -> void:
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(50, 0))
	touch(0, true, CENTER + Vector2(80, 0))
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.CANCEL])
	touch(0, false, CENTER + Vector2(80, 0))
	assert_eq(recorder.count("tap"), 1)
	assert_almost_eq(recorder.of("tap")[0].position, CENTER + Vector2(80, 0), Vector2(0.01, 0.01))


func test_mouse_left_button_is_a_pointer() -> void:
	mouse_button(MOUSE_BUTTON_LEFT, true, CENTER)
	mouse_button(MOUSE_BUTTON_LEFT, false, CENTER)
	assert_eq(recorder.count("tap"), 1)
	mouse_button(MOUSE_BUTTON_LEFT, true, CENTER)
	mouse_move(CENTER + Vector2(50, 0))
	mouse_button(MOUSE_BUTTON_LEFT, false, CENTER + Vector2(50, 0))
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.END])


func test_os_pointer_cancel() -> void:
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	recorder.clear()
	os_pointer_cancel(0, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0))
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.CANCEL])
	assert_almost_eq(recorder.of("drag")[0].position, CENTER + Vector2(SWIPE_MIN_DISTANCE * 2, 0), Vector2(0.01, 0.01))
	for kind: String in ["swipe", "tap", "long_press"]:
		assert_eq(recorder.count(kind), 0, kind)
	var calls: Array[InputCoreTestRecord] = recorder.of("pointer")
	assert_eq(calls.size(), 1, "the observer sees the cancel as the release")
	if calls.size() == 1:
		assert_eq([calls[0].pointer_id, calls[0].pressed], [0, false])
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(recorder.count("tap"), 1, "the pointer ID is free after the cancel")


func test_os_pointer_cancel_of_a_passed_pointer() -> void:
	var control: InputCoreTestControl = make_control(Rect2(1100.0, 500.0, 200.0, 200.0))
	var token: int = block_with([], [control])
	touch(0, true, CENTER)
	InputCore.inject_action(&"fire", true, 1.0, 0)
	assert_true(InputCore.is_pressed(&"fire"), "pointer 0 is a passed pointer")
	InputCore.inject_action(&"fire", false, 0.0, 0)
	os_pointer_cancel(0, CENTER + Vector2(400, 0))
	assert_eq(control.touch_releases, 1, "the cancel reaches the UI stage as the release")
	InputCore.inject_action(&"fire", true, 1.0, 0)
	assert_false(InputCore.is_pressed(&"fire"), "pointer 0 is not a passed pointer after the cancel")
	unblock(token)


## The engine makes mouse input from touch in the core project (`input_devices/pointing/emulate_mouse_from_touch`).
func test_mouse_input_the_engine_made_from_touch() -> void:
	assert_true(Input.is_emulating_mouse_from_touch(), "the engine makes mouse input from touch")
	assert_true(InputCore.set_keys(&"fire", PackedStringArray(["mouse_left"])))
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	recorder.clear()
	touch(0, true, CENTER)
	assert_false(InputCore.is_pressed(&"fire"), "the mouse left button press made from touch presses no action")
	drag(0, CENTER + Vector2(MOVE_THRESHOLD * 0.5, 0))
	touch(0, false, CENTER + Vector2(MOVE_THRESHOLD * 0.5, 0))
	await input_frame()
	assert_false(InputCore.is_just_pressed(&"fire"))
	assert_eq(recorder.count("tap"), 1)
	assert_eq(recorder.of("tap")[0].pointer_id, 0)
	assert_eq(recorder.count("drag"), 0)
	assert_false(InputCore.get_mouse_position().ok, "the mouse position is not set")
	assert_eq(InputCore.get_mouse_motion(), Vector2.ZERO)
	assert_eq(recorder.count("device"), 1)
	assert_eq(recorder.of("device")[0].device, InputCore.InputDevice.TOUCH)
	var calls: Array[InputCoreTestRecord] = recorder.of("pointer")
	assert_eq(calls.size(), 2, "the observer sees the touch press and release only")
	for record: InputCoreTestRecord in calls:
		assert_eq(record.pointer_id, 0)
	# blocked: the mouse input made from a touch outside the pass list element reaches no UI element
	var area: Rect2 = Rect2(1100.0, 500.0, 200.0, 200.0)
	var passed: InputCoreTestControl = make_control(area)
	var other: InputCoreTestControl = make_control(Rect2(1500.0, 500.0, 200.0, 200.0))
	touch(1, true, Vector2(1600.0, 600.0))
	drag(1, Vector2(1610.0, 600.0))
	touch(1, false, Vector2(1610.0, 600.0))
	var unblocked_inputs: int = other.gui_inputs
	assert_gt(unblocked_inputs, 3, "without a block the element gets the touch and the mouse input made from it")
	var token: int = block_with([], [passed])
	await run_frame_checks()
	touch(2, true, Vector2(1600.0, 600.0))
	drag(2, Vector2(1610.0, 600.0))
	touch(2, false, Vector2(1610.0, 600.0))
	assert_eq(other.gui_inputs, unblocked_inputs, "the element outside the pass list gets nothing")
	touch(3, true, area.get_center())
	drag(3, area.get_center() + Vector2(5, 0))
	touch(3, false, area.get_center() + Vector2(5, 0))
	assert_gt(passed.gui_inputs, 3, "the pass list element gets the touch and the mouse input made from it")
	assert_false(InputCore.is_pressed(&"fire"))
	unblock(token)


func test_pointer_ids_of_touch_and_mouse() -> void:
	touch(0, true, CENTER)
	mouse_button(MOUSE_BUTTON_LEFT, true, CENTER + RIGHT)
	touch(0, false, CENTER)
	mouse_button(MOUSE_BUTTON_LEFT, false, CENTER + RIGHT)
	var taps: Array[InputCoreTestRecord] = recorder.of("tap")
	assert_eq(taps.size(), 2)
	if taps.size() == 2:
		assert_eq(taps[0].pointer_id, 0, "a touch pointer's ID is its index")
		assert_eq(taps[1].pointer_id, 1000000, "the mouse left button's pointer ID")
	# a pass list element takes the pointer ID from the touch it gets and injects with it
	var control: InputCoreTestControl = make_control(Rect2(1100.0, 500.0, 200.0, 200.0))
	control.pointer_action = &"fire"
	var token: int = block_with([], [control])
	touch(3, true, CENTER)
	assert_true(InputCore.is_pressed(&"fire"), "fire is not in the pass list, but pointer 3 is a passed pointer")
	touch(3, false, CENTER)
	assert_false(InputCore.is_pressed(&"fire"))
	unblock(token)


## An OS pointer cancel of touch `index` at `position`.
func os_pointer_cancel(index: int, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = false
	event.canceled = true
	event.position = position
	InputCoreDev.inject_device_input(event)


func _pinch_off_on_cancel(event: DragEvent) -> void:
	if event.phase == InputCore.GesturePhase.CANCEL:
		InputCore.set_pinch_enabled(false)
