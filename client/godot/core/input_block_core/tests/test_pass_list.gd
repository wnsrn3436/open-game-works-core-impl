extends "res://core/input_block_core/tests/support/input_block_case.gd"
## Pass lists and the pass flags, and the checks that do not allocate memory.

const ACTION_A: StringName = &"menu_a"
const ACTION_B: StringName = &"menu_b"
const BACK: StringName = &"back"


func test_pass_flags_are_true_without_active_block() -> void:
	init_modules()
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	assert_true(InputBlockCore.pass_action(ACTION_A))
	assert_true(InputBlockCore.pass_action(BACK))
	assert_true(InputBlockCore.pass_position(_window(Vector2(10, 10))))
	assert_true(InputBlockCore.pass_position(Vector2(INF, NAN)))
	assert_true(InputBlockCore.pass_focus(element))


func test_pass_action_passes_only_the_listed_action() -> void:
	init_modules()
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [ACTION_A]
	var token: int = InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.pass_action(ACTION_A))
	assert_false(InputBlockCore.pass_action(ACTION_B))
	assert_false(InputBlockCore.pass_action(BACK))
	assert_true(InputBlockCore.unblock(token))
	assert_true(InputBlockCore.pass_action(ACTION_B))


func test_pass_action_needs_every_active_block_to_pass() -> void:
	init_modules()
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [ACTION_A]
	InputBlockCore.block("content", pass_list)
	var second: int = InputBlockCore.block("ui", pass_list)
	assert_true(InputBlockCore.pass_action(ACTION_A))
	var without_list: int = InputBlockCore.block("content")
	assert_false(InputBlockCore.pass_action(ACTION_A))
	assert_false(InputBlockCore.pass_action(BACK))
	assert_true(InputBlockCore.unblock(without_list))
	assert_true(InputBlockCore.unblock(second))
	assert_true(InputBlockCore.pass_action(ACTION_A))


func test_pass_position_inside_the_element_area() -> void:
	init_modules()
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element]
	InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.pass_position(_window(Vector2(120, 120))))
	assert_true(InputBlockCore.pass_position(_window(Vector2(100, 149))))
	assert_false(InputBlockCore.pass_position(_window(Vector2(99, 120))))
	assert_false(InputBlockCore.pass_position(_window(Vector2(120, 151))))
	assert_false(InputBlockCore.pass_position(_window(Vector2(10, 10))))
	element.visible = false
	assert_false(InputBlockCore.pass_position(_window(Vector2(120, 120))))
	element.visible = true
	assert_true(InputBlockCore.pass_position(_window(Vector2(120, 120))))
	element.free()
	assert_false(InputBlockCore.pass_position(_window(Vector2(120, 120))))


func test_pass_position_compares_in_window_pixels_of_the_test_screen() -> void:
	# a 1920x1080 window of a 1920x1080 base resolution: a window pixel is a game coordinates unit
	var window: Vector2i = Vector2i(1920, 1080)
	init_modules_with_test_screen(window, window)
	assert_ne(get_tree().root.size, window)
	assert_eq(ResolutionCore.get_window_size(), window)
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element]
	InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.pass_position(ResolutionCore.game_to_window(Vector2(120, 120))))
	assert_true(InputBlockCore.pass_position(ResolutionCore.game_to_window(Vector2(101, 149))))
	assert_false(InputBlockCore.pass_position(ResolutionCore.game_to_window(Vector2(99, 120))))
	assert_false(InputBlockCore.pass_position(ResolutionCore.game_to_window(Vector2(120, 151))))
	# inside the element when read as a real window pixel
	var real_inside: Vector2 = get_tree().root.get_screen_transform() * Vector2(120, 120)
	assert_false(InputBlockCore.pass_position(real_inside))


func test_pass_position_needs_every_active_block_to_pass() -> void:
	init_modules()
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element]
	InputBlockCore.block("content", pass_list)
	var without_list: int = InputBlockCore.block("content")
	assert_false(InputBlockCore.pass_position(_window(Vector2(120, 120))))
	assert_true(InputBlockCore.unblock(without_list))
	assert_true(InputBlockCore.pass_position(_window(Vector2(120, 120))))


func test_pass_position_of_position_that_is_not_finite_fails() -> void:
	init_modules()
	var element: Control = _control(Vector2(0, 0), Vector2(5000, 5000))
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element]
	InputBlockCore.block("content", pass_list)
	assert_false(InputBlockCore.pass_position(Vector2(NAN, 10)))
	assert_false(InputBlockCore.pass_position(Vector2(10, INF)))
	assert_eq(UnitTestCore.check_logs("error", TAG), 2)


func test_pass_focus_passes_the_element_and_its_descendants() -> void:
	init_modules()
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	var child: Control = Control.new()
	element.add_child(child)
	var grandchild: Button = Button.new()
	child.add_child(grandchild)
	var outside: Control = _control(Vector2(300, 300), Vector2(50, 50))
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.elements = [element]
	InputBlockCore.block("content", pass_list)
	assert_true(InputBlockCore.pass_focus(element))
	assert_true(InputBlockCore.pass_focus(child))
	assert_true(InputBlockCore.pass_focus(grandchild))
	assert_false(InputBlockCore.pass_focus(outside))
	element.visible = false
	assert_false(InputBlockCore.pass_focus(element))
	assert_false(InputBlockCore.pass_focus(grandchild))
	element.visible = true
	assert_true(InputBlockCore.pass_focus(grandchild))
	var without_list: int = InputBlockCore.block("content")
	assert_false(InputBlockCore.pass_focus(grandchild))
	assert_true(InputBlockCore.unblock(without_list))
	element.free()
	assert_false(InputBlockCore.pass_focus(element))
	assert_false(InputBlockCore.pass_focus(grandchild))
	assert_false(InputBlockCore.pass_focus(outside))


func test_checks_do_not_allocate_memory() -> void:
	init_modules()
	var element: Control = _control(Vector2(100, 100), Vector2(50, 50))
	var child: Control = Control.new()
	element.add_child(child)
	var pass_list: BlockPassList = BlockPassList.new()
	pass_list.actions = [ACTION_A]
	pass_list.elements = [element]
	var token: int = InputBlockCore.block("content", pass_list)
	InputBlockCore.block("ui", pass_list, element)
	var inside: Vector2 = _window(Vector2(120, 120))
	LogCore.release()
	_run_checks(token, inside, child, 100)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	_run_checks(token, inside, child, 1000)
	# both read before any assert: an assert allocates
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects)
	assert_true(memory_after <= memory)
	assert_eq(InputBlockCoreDev.count_active(), 2)


func _run_checks(token: int, inside: Vector2, focus: Control, count: int) -> void:
	for i: int in count:
		InputBlockCore.is_blocked()
		InputBlockCore.is_active(token)
		InputBlockCore.pass_action(ACTION_A)
		InputBlockCore.pass_action(ACTION_B)
		InputBlockCore.pass_position(inside)
		InputBlockCore.pass_focus(focus)
		InputBlockCore._check_blocks()


## A visible `Control` child of the root window at `at` with size `extent`, freed after the test.
func _control(at: Vector2, extent: Vector2) -> Control:
	var control: Control = Control.new()
	control.position = at
	control.size = extent
	get_tree().root.add_child(control)
	autofree(control)
	return control


## Window pixel position of a position of the root window canvas.
func _window(at: Vector2) -> Vector2:
	return get_tree().root.get_screen_transform() * at
