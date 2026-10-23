extends InputCoreTestCase
## Fill area stage on a `Letterbox` screen whose game area (0, 260) 1920x1080 leaves fill area bands above and below.

const FILL: Vector2 = Vector2(1200.0, 1450.0)
const VISIBLE: Vector2 = Vector2(1200.0, 800.0)


func before_each() -> void:
	super()
	set_screen(Vector2i(1920, 1080), Vector2i(1920, 1600))


func test_pointer_pressed_in_the_fill_area_changes_nothing() -> void:
	assert_false(ResolutionCore.get_visible_game_area().has_point(FILL))
	assert_true(ResolutionCore.get_visible_game_area().has_point(VISIBLE))
	var control: InputCoreTestControl = make_control(Rect2(1100.0, 1400.0, 200.0, 100.0))
	InputCore.set_ui_pointer_observer(recorder.on_pointer)
	InputCoreDev.set_test_device(InputCore.InputDevice.KEYBOARD_MOUSE)
	recorder.clear()
	touch(0, true, FILL)
	drag(0, VISIBLE)
	touch(0, false, VISIBLE)
	assert_eq(control.gui_inputs, 0, "the UI element gets nothing")
	for kind: String in ["pointer", "tap", "long_press", "drag", "swipe", "pinch"]:
		assert_eq(recorder.count(kind), 0, kind)
	assert_eq(recorder.count("device"), 1, "one device change")
	assert_eq(recorder.of("device")[0].device, InputCore.InputDevice.TOUCH)
	touch(1, true, FILL)
	touch(1, false, FILL)
	assert_eq(recorder.count("device"), 1, "the same device again")
	assert_true(InputCore.set_keys(&"fire", PackedStringArray(["mouse_left"])))
	mouse_button(MOUSE_BUTTON_LEFT, true, FILL)
	assert_false(InputCore.is_pressed(&"fire"), "the action state does not change")
	mouse_button(MOUSE_BUTTON_LEFT, false, FILL)


func test_pointer_moved_into_the_fill_area_ends_its_drag_there() -> void:
	touch(0, true, VISIBLE)
	drag(0, FILL)
	touch(0, false, FILL)
	assert_eq(recorder.drag_phases(), [InputCore.GesturePhase.START, InputCore.GesturePhase.END])
	assert_almost_eq(recorder.of("drag")[1].position, FILL, Vector2(0.01, 0.01))
