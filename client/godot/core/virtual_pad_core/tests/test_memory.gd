extends VirtualPadTestCase
## From a pointer to `InputCore.inject_action` VirtualPadCore allocates no memory.

const POINTER: int = 7

var _press: InputEventScreenTouch = null
var _move_a: InputEventScreenDrag = null
var _move_b: InputEventScreenDrag = null
var _lift: InputEventScreenTouch = null
var _stick: Control = null
var _fire: Control = null


func test_pointer_handling_allocates_nothing() -> void:
	await open(LAYOUT_FIXED)
	_stick = element(STICK)
	_fire = element(FIRE)
	_press = InputEventScreenTouch.new()
	_press.index = POINTER
	_press.pressed = true
	_press.position = BASE_DEFAULT + Vector2(30.0, 0.0)
	_move_a = InputEventScreenDrag.new()
	_move_a.index = POINTER
	_move_a.position = BASE_DEFAULT + Vector2(60.0, 40.0)
	_move_b = InputEventScreenDrag.new()
	_move_b.index = POINTER
	_move_b.position = BASE_DEFAULT + Vector2(-80.0, -150.0)
	_lift = InputEventScreenTouch.new()
	_lift.index = POINTER
	_lift.pressed = false
	LogCore.release()
	for i: int in 100:
		_cycle()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	for i: int in 1000:
		_cycle()
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "no object is made")
	assert_true(memory_after <= memory, "no memory is allocated")


## A joystick press, two moves and a release, and a button press and release, as their GUI input. Frame code.
func _cycle() -> void:
	VirtualPadCore._on_element_input(_stick, _press)
	VirtualPadCore._on_element_input(_stick, _move_a)
	VirtualPadCore._on_element_input(_stick, _move_b)
	VirtualPadCore._on_element_input(_stick, _lift)
	VirtualPadCore._on_element_input(_fire, _press)
	VirtualPadCore._on_element_input(_fire, _lift)
