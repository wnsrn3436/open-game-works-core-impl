extends "res://core/safe_area_core/tests/support/safe_area_case.gd"
## Placement of safe area roots and of UI elements with an ignore mark; what lies outside a safe area root.

const FULL: Vector4 = Vector4(0, 0, 1, 1)
const TOP_LEFT: Vector4 = Vector4(0, 0, 0, 0)


func test_safe_area_root_matches_the_safe_area() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var layer: CanvasLayer = new_layer()
	var root: SafeAreaRoot = new_root(layer)
	assert_rect(root.get_global_rect(), SafeAreaCore.get_safe_area())
	assert_eq(root.mouse_filter, Control.MOUSE_FILTER_IGNORE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	assert_rect(SafeAreaCore.get_safe_area(), Rect2(60, 20, 1800, 1030))
	assert_rect(root.get_global_rect(), SafeAreaCore.get_safe_area())
	# a root made after the notch is placed when it enters the tree
	var later: SafeAreaRoot = new_root(new_layer())
	assert_rect(later.get_global_rect(), SafeAreaCore.get_safe_area())


func test_full_anchored_ignore_element_covers_the_visible_game_area() -> void:
	init_modules()
	set_screen(LANDSCAPE, Vector2i(2560, 1080))
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	var root: SafeAreaRoot = new_root(new_layer())
	var element: Control = new_element(root, FULL, Vector4.ZERO, true)
	assert_rect(element.get_global_rect(), ResolutionCore.get_visible_game_area())
	assert_false(element.get_global_rect().is_equal_approx(root.get_global_rect()))
	# placed again with the root
	SafeAreaCoreDev.set_virtual_notch(200, 0, 0, 0)
	assert_rect(element.get_global_rect(), ResolutionCore.get_visible_game_area())


func test_top_left_ignore_element_keeps_its_offsets_against_the_visible_game_area() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	var root: SafeAreaRoot = new_root(new_layer())
	var offsets: Vector4 = Vector4(30, 40, 130, 90)
	var plain: Control = new_element(root, TOP_LEFT, offsets, false)
	var ignored: Control = new_element(root, TOP_LEFT, offsets, true)
	var visible_area: Rect2 = ResolutionCore.get_visible_game_area()
	var plain_position: Vector2 = plain.global_position - root.global_position
	assert_eq(plain_position, Vector2(30, 40))
	assert_eq(ignored.global_position - visible_area.position, plain_position)
	assert_eq(ignored.size, plain.size)


func test_outside_ui_and_world_do_not_move_with_the_notch() -> void:
	init_modules()
	set_screen_without_fill(LANDSCAPE)
	var layer: CanvasLayer = new_layer()
	new_root(layer)
	var outside: Control = new_element(layer, TOP_LEFT, Vector4(10, 20, 310, 220), false)
	var world: Node2D = Node2D.new()
	world.position = Vector2(50, 60)
	add_child_autofree(world)
	var outside_rect: Rect2 = outside.get_global_rect()
	var world_transform: Transform2D = world.get_global_transform_with_canvas()
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	assert_rect(outside.get_global_rect(), outside_rect)
	assert_eq(world.get_global_transform_with_canvas(), world_transform)
	SafeAreaCoreDev.clear_virtual_notch()
	assert_rect(outside.get_global_rect(), outside_rect)
	assert_eq(world.get_global_transform_with_canvas(), world_transform)


func test_ignore_element_under_a_parent_outside_the_rule_logs_in_dev_build() -> void:
	init_modules()
	CoreBuildInfo.has_dev_code = true
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	var layer: CanvasLayer = new_layer()
	new_root(layer)
	var parent: Control = new_element(layer, TOP_LEFT, Vector4(5, 5, 105, 105), false)
	var element: Control = new_element(parent, FULL, Vector4.ZERO, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(UnitTestCore.check_logs("error", TAG), 1)
	assert_rect(element.get_global_rect(), ResolutionCore.get_visible_game_area())


func test_ignore_element_under_a_parent_outside_the_rule_does_not_log_without_dev_code() -> void:
	init_modules()
	CoreBuildInfo.has_dev_code = false
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	var layer: CanvasLayer = new_layer()
	new_root(layer)
	var parent: Control = new_element(layer, TOP_LEFT, Vector4(5, 5, 105, 105), false)
	var element: Control = new_element(parent, FULL, Vector4.ZERO, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(UnitTestCore.check_logs("error", TAG), 0)
	assert_rect(element.get_global_rect(), ResolutionCore.get_visible_game_area())


func test_ignore_element_under_a_parent_sized_to_the_root_after_adding_does_not_log() -> void:
	init_modules()
	CoreBuildInfo.has_dev_code = true
	set_screen_without_fill(LANDSCAPE)
	SafeAreaCoreDev.set_virtual_notch(120, 40, 0, 60)
	var root: SafeAreaRoot = new_root(new_layer())
	# like a loading screen: the screen root is added first and sized to the safe area root after
	var screen: Control = Control.new()
	var background: Control = new_element(screen, FULL, Vector4.ZERO, true)
	root.add_child(screen)
	screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	assert_rect(background.get_global_rect(), ResolutionCore.get_visible_game_area())
	await UnitTestCore.wait_frames(2)
	assert_rect(screen.get_global_rect(), SafeAreaCore.get_safe_area())
	assert_rect(background.get_global_rect(), ResolutionCore.get_visible_game_area())
