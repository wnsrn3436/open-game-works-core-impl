extends InputCoreTestCase
## Device input processing, gesture judging and event publishing allocate no memory.

const TOUCH_SECOND: Vector2 = CENTER + Vector2(300.0, 0.0)

var _counter: InputCoreTestCounter = null
var _key_press: InputEventKey = null
var _key_release: InputEventKey = null
var _pad_press: InputEventJoypadButton = null
var _pad_release: InputEventJoypadButton = null
var _axis_on: InputEventJoypadMotion = null
var _axis_half: InputEventJoypadMotion = null
var _axis_off: InputEventJoypadMotion = null
var _touch_press: InputEventScreenTouch = null
var _touch_move_a: InputEventScreenDrag = null
var _touch_move_b: InputEventScreenDrag = null
var _touch_release_far: InputEventScreenTouch = null
var _touch_release: InputEventScreenTouch = null
var _second_press: InputEventScreenTouch = null
var _second_move: InputEventScreenDrag = null
var _second_release: InputEventScreenTouch = null
var _mouse_move: InputEventMouseMotion = null
var _mouse_right_press: InputEventMouseButton = null
var _mouse_right_release: InputEventMouseButton = null
var _mouse_left_press: InputEventMouseButton = null
var _mouse_left_release: InputEventMouseButton = null


func test_device_input_gestures_and_events_allocate_nothing() -> void:
	_make_inputs()
	InputCore.set_pinch_enabled(true)
	EventCore.unsubscribe_all(recorder)
	_counter = keep(InputCoreTestCounter.new()) as InputCoreTestCounter
	assert_true(_counter.subscribe_all())
	_cycle()
	assert_gt(_counter.device, 0, "the cycle changes the device")
	assert_gt(_counter.prompt, 0, "the cycle changes the prompt family")
	assert_gt(_counter.tap, 0, "the cycle taps")
	assert_gt(_counter.drag, 0, "the cycle drags")
	assert_gt(_counter.swipe, 0, "the cycle swipes")
	assert_gt(_counter.pinch, 0, "the cycle pinches")
	var per_cycle: int = _counter.total()
	LogCore.release()
	for i: int in 100:
		_cycle()
	var events: int = _counter.total()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		_cycle()
	# Read both before asserting: an assert allocates.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "no object is made")
	assert_true(memory_after <= memory, "no memory is allocated")
	assert_eq(_counter.total() - events, 1000 * per_cycle, "every cycle publishes the same events")


## Key, gamepad button and axis, touch drag, swipe, tap and pinch, and mouse input, each as the core node gets it with
## no UI element taking it, and a frame. Frame code.
func _cycle() -> void:
	_deliver(_key_press)
	_deliver(_key_release)
	_deliver(_pad_press)
	_deliver(_pad_release)
	_deliver(_axis_on)
	_deliver(_axis_half)
	_deliver(_axis_off)
	_deliver(_touch_press)
	_deliver(_touch_move_a)
	_deliver(_touch_move_b)
	_deliver(_touch_release_far)
	_deliver(_touch_press)
	_deliver(_touch_release)
	_deliver(_touch_press)
	_deliver(_second_press)
	_deliver(_second_move)
	_deliver(_second_release)
	_deliver(_touch_release)
	_deliver(_mouse_move)
	_deliver(_mouse_right_press)
	_deliver(_mouse_right_release)
	_deliver(_mouse_left_press)
	_deliver(_mouse_left_release)
	InputCore._on_frame()


func _deliver(event: InputEvent) -> void:
	InputCore._on_input(event)
	InputCore._on_unhandled_input(event)


## The device inputs of a cycle, with the root viewport positions the core node's `_input` gets.
func _make_inputs() -> void:
	_key_press = key_event(KEY_D, true)
	_key_release = key_event(KEY_D, false)
	_pad_press = pad_button_event(JOY_BUTTON_X, true)
	_pad_release = pad_button_event(JOY_BUTTON_X, false)
	_axis_on = pad_axis_event(JOY_AXIS_LEFT_X, 0.8)
	_axis_half = pad_axis_event(JOY_AXIS_LEFT_X, 0.3)
	_axis_off = pad_axis_event(JOY_AXIS_LEFT_X, 0.0)
	_touch_press = _touch_event(0, true, CENTER)
	_touch_move_a = _drag_event(0, CENTER + Vector2(50.0, 0.0))
	_touch_move_b = _drag_event(0, CENTER + Vector2(150.0, 0.0))
	_touch_release_far = _touch_event(0, false, CENTER + Vector2(150.0, 0.0))
	_touch_release = _touch_event(0, false, CENTER)
	_second_press = _touch_event(1, true, TOUCH_SECOND)
	_second_move = _drag_event(1, TOUCH_SECOND + Vector2(100.0, 0.0))
	_second_release = _touch_event(1, false, TOUCH_SECOND + Vector2(100.0, 0.0))
	_mouse_move = InputEventMouseMotion.new()
	_mouse_move.position = to_viewport(CENTER)
	_mouse_right_press = _mouse_event(MOUSE_BUTTON_RIGHT, true)
	_mouse_right_release = _mouse_event(MOUSE_BUTTON_RIGHT, false)
	_mouse_left_press = _mouse_event(MOUSE_BUTTON_LEFT, true)
	_mouse_left_release = _mouse_event(MOUSE_BUTTON_LEFT, false)


func _touch_event(index: int, pressed: bool, position: Vector2) -> InputEventScreenTouch:
	var event: InputEventScreenTouch = InputEventScreenTouch.new()
	event.index = index
	event.pressed = pressed
	event.position = to_viewport(position)
	return event


func _drag_event(index: int, position: Vector2) -> InputEventScreenDrag:
	var event: InputEventScreenDrag = InputEventScreenDrag.new()
	event.index = index
	event.position = to_viewport(position)
	return event


func _mouse_event(button: MouseButton, pressed: bool) -> InputEventMouseButton:
	var event: InputEventMouseButton = mouse_button_event(button, pressed)
	event.position = to_viewport(CENTER)
	return event
