extends InputCoreTestCase
## `inject_device_input` goes the same way as engine device input.


func test_injected_touch_and_key_match_engine_input() -> void:
	_engine_touch(0, true, CENTER)
	_engine_touch(0, false, CENTER)
	Input.parse_input_event(key_event(KEY_J, true))
	Input.flush_buffered_events()
	var engine_taps: Array[InputCoreTestRecord] = recorder.of("tap")
	await input_frame()
	var engine_state: Array[bool] = [InputCore.is_pressed(&"jump"), InputCore.is_just_pressed(&"jump")]
	Input.parse_input_event(key_event(KEY_J, false))
	Input.flush_buffered_events()
	await next_frame()
	recorder.clear()
	touch(0, true, CENTER)
	touch(0, false, CENTER)
	key(KEY_J, true)
	assert_eq(recorder.count("tap"), engine_taps.size())
	assert_eq(engine_taps.size(), 1)
	assert_almost_eq(recorder.of("tap")[0].position, engine_taps[0].position, Vector2(0.01, 0.01))
	await input_frame()
	assert_eq([InputCore.is_pressed(&"jump"), InputCore.is_just_pressed(&"jump")], engine_state)
	assert_eq(engine_state, [true, true])


func test_injected_drag_matches_engine_drag() -> void:
	_engine_touch(0, true, CENTER)
	var engine_drag: InputEventScreenDrag = InputEventScreenDrag.new()
	engine_drag.index = 0
	engine_drag.position = to_window(CENTER + Vector2(40, 0))
	Input.parse_input_event(engine_drag)
	Input.flush_buffered_events()
	_engine_touch(0, false, CENTER + Vector2(40, 0))
	var engine_drags: Array[InputCoreTestRecord] = recorder.of("drag")
	recorder.clear()
	touch(0, true, CENTER)
	drag(0, CENTER + Vector2(40, 0))
	touch(0, false, CENTER + Vector2(40, 0))
	var drags: Array[InputCoreTestRecord] = recorder.of("drag")
	assert_eq(drags.size(), engine_drags.size())
	assert_eq(drags.size(), 2)
	for i: int in mini(drags.size(), engine_drags.size()):
		assert_eq(drags[i].phase, engine_drags[i].phase)
		assert_almost_eq(drags[i].position, engine_drags[i].position, Vector2(0.01, 0.01))
		assert_almost_eq(drags[i].delta, engine_drags[i].delta, Vector2(0.01, 0.01))


func test_injected_mouse_motion_has_the_relative_motion_from_the_last_position() -> void:
	mouse_move(CENTER)
	await next_frame()
	mouse_move(CENTER + Vector2(30, -10))
	assert_almost_eq(InputCore.get_mouse_motion(), Vector2(30, -10), Vector2(0.01, 0.01))


func _engine_touch(index: int, pressed: bool, position: Vector2) -> void:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = to_window(position)
	Input.parse_input_event(event)
	Input.flush_buffered_events()


## A test screen whose window size is not the real window size: a UI element drawn at a game position under the root
## (whose canvas is the window area in game coordinates) gets the injected press and release at that position, and
## InputCore reports that position.
func test_injected_input_under_a_test_screen_reaches_the_ui_element_drawn_at_its_game_position() -> void:
	var real: Vector2i = get_tree().root.size
	set_screen(Vector2i(1920, 1080), Vector2i(real.x * 3 + 7, real.y * 2 + 5))
	await next_frame()
	var visible: Rect2 = ResolutionCore.get_visible_game_area()
	var rect: Rect2 = Rect2(visible.get_center() + Vector2(100, 50), Vector2(80, 40))
	var control: InputCoreTestControl = InputCoreTestControl.new()
	control.position = rect.position
	control.size = rect.size
	get_tree().root.add_child(control)
	_nodes.append(control)
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	recorder.clear()
	UnitTestCore.tap(rect.get_center())
	assert_eq(control.gui_inputs, 2, "the press and the release reach the element (real window %s, test window %s)"
			% [real, ResolutionCore.get_window_size()])
	var pointers: Array[InputCoreTestRecord] = recorder.of("pointer")
	assert_eq(pointers.size(), 2)
	for record: InputCoreTestRecord in pointers:
		assert_almost_eq(record.position, rect.get_center(), Vector2(0.01, 0.01))
	recorder.clear()
	touch(0, true, rect.get_center())
	touch(0, false, rect.get_center())
	assert_eq(control.touch_presses, 1, "the touch press reaches the element")
	assert_eq(control.touch_releases, 1)
	pointers = recorder.of("pointer")
	assert_eq(pointers.size(), 2)
	for record: InputCoreTestRecord in pointers:
		assert_almost_eq(record.position, rect.get_center(), Vector2(0.01, 0.01))
