extends "res://core/safe_area_core/tests/support/safe_area_case.gd"
## `init`, `release`, teardown without `release`, calls outside `init`, and the placement targets across `release`.


func test_release_puts_every_static_var_back_and_removes_the_core_node() -> void:
	assert_false(SafeAreaCore.is_initialized())
	init_modules()
	assert_true(SafeAreaCore.is_initialized())
	var node: Node = SafeAreaCore._node
	assert_true(is_instance_valid(node) and node.is_inside_tree())
	set_screen_without_fill(LANDSCAPE)
	var root: SafeAreaRoot = new_root(new_layer())
	new_element(root, Vector4(0, 0, 1, 1), Vector4.ZERO, true)
	SafeAreaCoreDev.set_virtual_notch(100, 0, 0, 0)
	SafeAreaCoreDev.set_virtual_keyboard(300)
	SafeAreaCore.release()
	assert_false(SafeAreaCore.is_initialized())
	_assert_initial_state()
	assert_false(node.is_inside_tree())
	assert_eq(EventCore.count_subscriptions(node), 0)


func test_tree_teardown_without_release_clears_like_release() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var root: SafeAreaRoot = new_root(new_layer())
	new_element(root, Vector4(0, 0, 1, 1), Vector4.ZERO, true)
	SafeAreaCoreDev.set_virtual_notch(100, 0, 0, 0)
	var node: Node = SafeAreaCore._node
	node.free()
	assert_false(SafeAreaCore.is_initialized())
	_assert_initial_state()
	assert_true(SafeAreaCore.init())


func test_init_of_an_initialized_module_fails() -> void:
	init_modules()
	assert_false(SafeAreaCore.init())
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_true(SafeAreaCore.is_initialized())


func test_operations_outside_init_return_failure_values() -> void:
	init_modules()
	SafeAreaCore.release()
	assert_eq(SafeAreaCore.get_safe_area(), Rect2())
	assert_eq(SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT), 0.0)
	assert_eq(SafeAreaCore.get_keyboard_area(), Rect2())
	SafeAreaCoreDev.set_virtual_notch(10, 10, 10, 10)
	SafeAreaCoreDev.clear_virtual_notch()
	SafeAreaCoreDev.set_virtual_keyboard(10)
	SafeAreaCoreDev.clear_virtual_keyboard()
	assert_eq(UnitTestCore.check_logs("error", TAG), 7)
	assert_false(SafeAreaCore._has_virtual_notch)
	assert_eq(SafeAreaCore._virtual_keyboard_height, SafeAreaCore._NO_VIRTUAL_KEYBOARD)


func test_release_keeps_the_placement_and_init_places_only_targets_that_enter_again() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(200, 0, 0, 0)
	var layer: CanvasLayer = new_layer()
	var root: SafeAreaRoot = new_root(layer)
	var placed: Rect2 = root.get_global_rect()
	var moved_layer: CanvasLayer = new_layer()
	var moved: SafeAreaRoot = new_root(moved_layer)
	SafeAreaCore.release()
	assert_rect(root.get_global_rect(), placed)
	assert_true(SafeAreaCore.init())
	# no virtual notch after release: the safe area is the visible game area, but only a root that enters the tree
	# again is placed by it
	assert_rect(SafeAreaCore.get_safe_area(), ResolutionCore.get_visible_game_area())
	assert_rect(root.get_global_rect(), placed)
	moved_layer.remove_child(moved)
	moved_layer.add_child(moved)
	assert_rect(moved.get_global_rect(), SafeAreaCore.get_safe_area())
	SafeAreaCoreDev.set_virtual_notch(0, 100, 0, 0)
	assert_rect(root.get_global_rect(), placed)
	assert_rect(moved.get_global_rect(), SafeAreaCore.get_safe_area())


func _assert_initial_state() -> void:
	assert_null(SafeAreaCore._session)
	assert_null(SafeAreaCore._node)
	assert_eq(SafeAreaCore._rotation_check_interval_ms, 0)
	assert_eq(SafeAreaCore._next_rotation_check_ms, 0)
	assert_eq(SafeAreaCore._safe_area, Rect2())
	assert_eq(SafeAreaCore._inset_left, 0.0)
	assert_eq(SafeAreaCore._inset_top, 0.0)
	assert_eq(SafeAreaCore._inset_right, 0.0)
	assert_eq(SafeAreaCore._inset_bottom, 0.0)
	assert_eq(SafeAreaCore._visible_area, Rect2())
	assert_eq(SafeAreaCore._os_area, Rect2())
	assert_eq(SafeAreaCore._keyboard_area, Rect2())
	assert_eq(SafeAreaCore._os_keyboard_height, 0)
	assert_eq(SafeAreaCore._roots.size(), 0)
	assert_eq(SafeAreaCore._ignores.size(), 0)
	assert_false(SafeAreaCore._publishing)
	assert_false(SafeAreaCore._safe_area_pending)
	assert_false(SafeAreaCore._keyboard_pending)
	assert_false(SafeAreaCore._has_virtual_notch)
	assert_eq(SafeAreaCore._virtual_notch, Vector4i.ZERO)
	assert_eq(SafeAreaCore._virtual_keyboard_height, SafeAreaCore._NO_VIRTUAL_KEYBOARD)
