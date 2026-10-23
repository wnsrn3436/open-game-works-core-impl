extends InputCoreTestCase
## UI stage: consumed input, consumed release and the UI pointer observer.

const AREA: Rect2 = Rect2(1100.0, 500.0, 200.0, 200.0)
const OUTSIDE: Vector2 = Vector2(1600.0, 600.0)


func test_pointer_whose_press_the_ui_consumed_makes_no_gesture() -> void:
	make_control(AREA)
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(300, 0))
	touch(0, false, CENTER + Vector2(300, 0))
	assert_eq(recorder.count("tap"), 0)
	assert_eq(recorder.count("drag"), 0)
	assert_eq(recorder.count("swipe"), 0)
	touch(1, true, CENTER)
	await run_frame_checks()
	advance(LONG_PRESS_MS)
	await run_frame_checks()
	touch(1, false, CENTER)
	assert_eq(recorder.count("long_press"), 0)


func test_consumed_key_press_and_release() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	control.consume_keys = true
	control.focus_mode = Control.FOCUS_ALL
	control.grab_focus()
	key(KEY_SPACE, true)
	assert_eq(control.keys, 1)
	assert_false(InputCore.is_pressed(&"cutscene_advance"), "the focused element consumed the press")
	key(KEY_SPACE, false)
	control.release_focus()
	key(KEY_SPACE, true)
	assert_true(InputCore.is_pressed(&"cutscene_advance"))
	control.grab_focus()
	key(KEY_SPACE, false)
	assert_eq(control.keys, 3)
	assert_false(InputCore.is_pressed(&"cutscene_advance"), "a consumed release releases the source")


func test_observer_sees_every_pointer_press_and_release_of_the_ui_stage() -> void:
	make_control(AREA)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	touch(1, true, OUTSIDE)
	touch(1, false, OUTSIDE)
	var calls: Array[InputCoreTestRecord] = recorder.of("pointer")
	assert_eq(calls.size(), 4)
	assert_eq([calls[0].pointer_id, calls[0].pressed], [0, true])
	assert_eq([calls[1].pointer_id, calls[1].pressed], [0, false])
	assert_eq([calls[2].pointer_id, calls[2].pressed], [1, true])
	assert_eq([calls[3].pointer_id, calls[3].pressed], [1, false])
	assert_almost_eq(calls[0].position, CENTER, Vector2(0.01, 0.01))
	assert_almost_eq(calls[3].position, OUTSIDE, Vector2(0.01, 0.01))
	assert_eq(recorder.count("tap"), 1, "the results are as without the observer")
	InputCore.set_ui_pointer_observer(Callable())
	touch(2, true, OUTSIDE)
	touch(2, false, OUTSIDE)
	assert_eq(recorder.count("pointer"), 4, "an empty callable clears the observer")
	assert_eq(recorder.count("tap"), 2)


func test_observer_is_not_called_for_discarded_input() -> void:
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	var token: int = block_all()
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	assert_eq(recorder.count("pointer"), 0)
	unblock(token)
