extends InputCoreTestCase
## Mouse position and mouse motion.

const AREA: Rect2 = Rect2(1100.0, 500.0, 200.0, 200.0)


func test_mouse_position() -> void:
	var result: GetMousePositionResult = InputCore.get_mouse_position()
	assert_false(result.ok)
	assert_eq(result.position, Vector2.ZERO)
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(30, 0))
	touch(0, false, CENTER + Vector2(30, 0))
	assert_false(InputCore.get_mouse_position().ok, "touch does not change it")
	mouse_move(CENTER + Vector2(5, 5))
	result = InputCore.get_mouse_position()
	assert_true(result.ok)
	assert_almost_eq(result.position, CENTER + Vector2(5, 5), Vector2(0.01, 0.01))
	mouse_button(MOUSE_BUTTON_RIGHT, true, CENTER + Vector2(7, 0))
	assert_almost_eq(InputCore.get_mouse_position().position, CENTER + Vector2(7, 0), Vector2(0.01, 0.01))
	InputCore.release()
	result = InputCore.get_mouse_position()
	assert_false(result.ok)
	assert_eq(result.position, Vector2.ZERO)
	assert_eq(errors(), 1)


func test_mouse_motion_of_a_frame() -> void:
	mouse_move(CENTER)
	await next_frame()
	assert_eq(InputCore.get_mouse_motion(), Vector2.ZERO)
	mouse_move(CENTER + Vector2(10, 5))
	mouse_move(CENTER + Vector2(15, 5))
	assert_almost_eq(InputCore.get_mouse_motion(), Vector2(15, 5), Vector2(0.01, 0.01))
	await next_frame()
	assert_eq(InputCore.get_mouse_motion(), Vector2.ZERO)


func test_first_mouse_motion_without_a_position_is_zero() -> void:
	mouse_move(CENTER)
	assert_eq(InputCore.get_mouse_motion(), Vector2.ZERO)


func test_ui_consumption_block_fill_area_and_cancel() -> void:
	var control: InputCoreTestControl = make_control(AREA)
	mouse_button(MOUSE_BUTTON_RIGHT, true, CENTER)
	await next_frame()
	mouse_move(CENTER + Vector2(20, 0))
	assert_eq(control.mouse_motions, 1, "the UI element that got the right button press consumed the motion")
	assert_almost_eq(InputCore.get_mouse_position().position, CENTER + Vector2(20, 0), Vector2(0.01, 0.01))
	assert_almost_eq(InputCore.get_mouse_motion(), Vector2(20, 0), Vector2(0.01, 0.01))
	mouse_button(MOUSE_BUTTON_RIGHT, false, CENTER + Vector2(20, 0))
	mouse_move(CENTER)
	await next_frame()
	var token: int = block_with([], [control])
	mouse_move(CENTER + Vector2(400, 0))
	assert_almost_eq(InputCore.get_mouse_position().position, CENTER, Vector2(0.01, 0.01), "outside the pass list")
	assert_eq(InputCore.get_mouse_motion(), Vector2.ZERO)
	unblock(token)
	set_screen(Vector2i(1920, 1080), Vector2i(1920, 1600))
	mouse_button(MOUSE_BUTTON_LEFT, true, Vector2(1200, 1450))
	assert_almost_eq(InputCore.get_mouse_position().position, CENTER, Vector2(0.01, 0.01), "pressed in the fill area")
	mouse_move(Vector2(1200, 1460))
	assert_almost_eq(InputCore.get_mouse_position().position, CENTER, Vector2(0.01, 0.01))
	mouse_button(MOUSE_BUTTON_LEFT, false, Vector2(1200, 1460))
	mouse_move(CENTER + Vector2(0, 20))
	var position: Vector2 = InputCore.get_mouse_position().position
	var motion: Vector2 = InputCore.get_mouse_motion()
	InputCore.cancel_input()
	assert_eq(InputCore.get_mouse_position().position, position, "cancel_input does not change them")
	assert_eq(InputCore.get_mouse_motion(), motion)
