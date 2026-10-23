extends InputCoreTestCase
## Input cancel: `cancel_input`, app focus loss and background entry.

const RIGHT: Vector2 = Vector2(200.0, 0.0)
const DOWN: Vector2 = Vector2(0.0, 200.0)


func test_cancel_input() -> void:
	InputCore.set_pinch_enabled(true)
	key(KEY_J, true)
	touch(0, true, CENTER)
	touch(1, true, CENTER + RIGHT)
	touch(2, true, CENTER + DOWN)
	drag(2, CENTER + DOWN + Vector2(50, 0))
	touch(3, true, CENTER - RIGHT)
	recorder.clear()
	InputCore.cancel_input()
	assert_false(InputCore.is_pressed(&"jump"))
	assert_true(InputCore.is_just_released(&"jump"))
	assert_eq(InputCore.get_cancel_count(), 1)
	assert_eq(recorder.pinch_phases(), [InputCore.GesturePhase.CANCEL])
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.CANCEL])
	assert_eq(recorder.of("drag")[0].pointer_id, 2)
	advance(LONG_PRESS_MS)
	await run_frame_checks()
	assert_eq(recorder.count("long_press"), 0)
	drag(2, CENTER + DOWN + Vector2(150, 0))
	drag(0, CENTER + Vector2(0, -100))
	for i: int in 4:
		touch(i, false, CENTER)
	assert_eq(recorder.count("drag"), 1, "the later moves and releases make no gesture")
	assert_eq(recorder.count("pinch"), 1)
	assert_eq(recorder.count("tap"), 0)
	assert_eq(recorder.count("swipe"), 0)


func test_focus_loss_cancels_input() -> void:
	key(KEY_J, true)
	InputCoreDev.inject_focus_lost()
	assert_false(InputCore.is_pressed(&"jump"))
	assert_eq(InputCore.get_cancel_count(), 1)
	key(KEY_J, false)
	key(KEY_J, true)
	InputCore._node.notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	assert_false(InputCore.is_pressed(&"jump"))
	assert_eq(InputCore.get_cancel_count(), 2)


func test_background_cancels_input() -> void:
	key(KEY_J, true)
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(50, 0))
	recorder.clear()
	UnitTestCore.advance_clock(1000, true)
	assert_false(InputCore.is_pressed(&"jump"))
	assert_eq(InputCore.get_cancel_count(), 1)
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.CANCEL])


func test_cancel_input_ends_the_waits() -> void:
	start_wait_key()
	start_wait_pad_button()
	InputCore.cancel_input()
	assert_eq(key_result, "")
	assert_eq(pad_result, "")
