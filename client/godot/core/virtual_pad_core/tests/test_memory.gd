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


func test_first_area_presses_after_open_allocate_nothing() -> void:
	await open(LAYOUT_FIXED)
	_stick = element(STICK)
	_fire = element(FIRE)
	var presses: Array[InputEventScreenTouch] = []
	for i: int in 2:
		var press: InputEventScreenTouch = InputEventScreenTouch.new()
		press.index = POINTER + i
		press.pressed = true
		press.position = BASE_DEFAULT + Vector2(30.0, 0.0)
		presses.append(press)
	LogCore.release()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	VirtualPadCore._on_element_input(_stick, presses[0])
	VirtualPadCore._on_element_input(_fire, presses[1])
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the button takes the second pointer")
	assert_true(objects_after <= objects, "no object is made")
	assert_true(memory_after <= memory, "two area pointers at once after open_layout allocate no memory")


func test_a_press_after_16_consumed_pointers_allocates_nothing() -> void:
	await _press_after_consumed(16)


## The tracked consumed pointers fill every slot, so the measured press finds the slots full.
func test_a_press_with_every_consumed_slot_in_use_allocates_nothing() -> void:
	await _press_after_consumed(VirtualPadCore._CONSUMED_CAPACITY)


func test_a_press_beyond_the_tracked_consumed_pointers_allocates_nothing() -> void:
	await _press_after_consumed(VirtualPadCore._CONSUMED_CAPACITY + 4)


## Presses `count` touches in the `fire` area (the first one held by `fire`, the others consumed with no element
## holding them), then measures a `stick` press at 0.5 times the radius to the right of the base center. `InputCore`
## tracks every one of those pointers, so the releases at the end of the test reach the engine GUI.
func _press_after_consumed(count: int) -> void:
	assert_true(UnitTestCore.set_test_settings("InputCore.maxJudgePointers", 100))
	assert_true(await restart_modules(), "the modules start with 100 judge pointers")
	await open(LAYOUT_FIXED)
	_stick = element(STICK)
	for i: int in count:
		touch(i, true, center_of(FIRE))
	assert_true(InputCore.is_pressed(FIRE_ACTION), "the button takes the first pointer")
	var press: InputEventScreenTouch = InputEventScreenTouch.new()
	press.index = count
	press.pressed = true
	press.position = BASE_DEFAULT + Vector2(RADIUS * 0.5, 0.0)
	LogCore.release()
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	VirtualPadCore._on_element_input(_stick, press)
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_vector(Vector2(0.5, 0.0), "the joystick takes the pointer pressed after %d consumed pointers" % count)
	assert_true(objects_after <= objects, "no object is made")
	assert_true(memory_after <= memory, "a press after %d consumed pointers allocates no memory" % count)


## A joystick press, two moves and a release, and a button press and release, as their GUI input. Frame code.
func _cycle() -> void:
	VirtualPadCore._on_element_input(_stick, _press)
	VirtualPadCore._on_element_input(_stick, _move_a)
	VirtualPadCore._on_element_input(_stick, _move_b)
	VirtualPadCore._on_element_input(_stick, _lift)
	VirtualPadCore._on_element_input(_fire, _press)
	VirtualPadCore._on_element_input(_fire, _lift)
