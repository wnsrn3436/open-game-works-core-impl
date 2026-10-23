extends UnitTestCase
## Lifecycle of `ResolutionCore`: init check, the state `release` puts back, the core node, init failures and
## operations before `init`.

const _SUPPORT := preload("res://core/resolution_core/tests/support/resolution_test_support.gd")


func after_each() -> void:
	get_tree().paused = false
	super()
	_SUPPORT.stop()


func test_init_check_before_init_after_init_and_after_release() -> void:
	assert_false(ResolutionCore.is_initialized())
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	assert_true(ResolutionCore.is_initialized())
	ResolutionCore.release()
	assert_false(ResolutionCore.is_initialized())


func test_release_puts_every_static_var_back_and_draws_the_widened_size() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_fill_color(1, 2, 3)
	_SUPPORT.set_fill_image(_SUPPORT.FILL_IMAGE_KEY)
	assert_true(_SUPPORT.start())
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(2560, 1080), ResolutionCore.FillMode.CROP, true)
	ResolutionCore.load_fill_image()
	await ResourceCore.load(_SUPPORT.FILL_IMAGE_KEY, ResourceCore.BaseKind.TEXTURE_2D, ResourceCore.get_global_scope())
	var node: Node = ResolutionCore._node
	assert_true(node.is_inside_tree())
	var base: Vector2i = ResolutionCore._base
	ResolutionCore.release()
	assert_false(node.is_inside_tree())
	assert_null(ResolutionCore._node)
	assert_null(ResolutionCore._session)
	assert_false(ResolutionCore._applying)
	assert_eq(ResolutionCore._base, Vector2i.ZERO)
	assert_eq(ResolutionCore._max, Vector2i.ZERO)
	assert_eq(ResolutionCore._fill_color, Color.BLACK)
	assert_eq(ResolutionCore._fill_image_key, "")
	assert_eq(ResolutionCore._platform_fill_mode, ResolutionCore.FillMode.LETTERBOX)
	assert_false(ResolutionCore._platform_supported)
	assert_false(ResolutionCore._test_active)
	assert_eq(ResolutionCore._test_base, Vector2i.ZERO)
	assert_eq(ResolutionCore._test_window, Vector2i.ZERO)
	assert_eq(ResolutionCore._test_fill_mode, ResolutionCore.FillMode.LETTERBOX)
	assert_false(ResolutionCore._test_supported)
	assert_eq(ResolutionCore._orientation, ResolutionCore.ScreenOrientation.LANDSCAPE)
	assert_eq(ResolutionCore._window_size, Vector2i.ZERO)
	assert_eq(ResolutionCore._fill_mode, ResolutionCore.FillMode.LETTERBOX)
	assert_eq(ResolutionCore._game_area, Rect2())
	assert_eq(ResolutionCore._visible_game_area, Rect2())
	assert_eq(ResolutionCore._scale, 0.0)
	assert_eq(ResolutionCore._window_area, Vector2i.ZERO)
	assert_eq(ResolutionCore._transition, ResolutionCore._NO_TRANSITION)
	assert_false(ResolutionCore._transition_titlebar)
	assert_false(ResolutionCore._transition_hidden)
	assert_eq(ResolutionCore._transition_frame, 0)
	assert_false(ResolutionCore._fill_load_started)
	assert_false(ResolutionCore._fill_loading)
	assert_null(ResolutionCore._fill_texture)
	var root: Window = get_tree().root
	assert_eq(root.content_scale_mode, Window.CONTENT_SCALE_MODE_CANVAS_ITEMS)
	assert_eq(root.content_scale_aspect, Window.CONTENT_SCALE_ASPECT_EXPAND)
	assert_eq(root.content_scale_size, base)


func test_release_clears_set_test_screen() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_size_setting("maxResolution", Vector2i(1440, 2400))
	assert_true(_SUPPORT.start())
	ResolutionCoreDev.set_test_screen(Vector2i(1080, 1920), Vector2i(1080, 2520), ResolutionCore.FillMode.CROP, false)
	ResolutionCore.release()
	assert_true(ResolutionCore.init())
	assert_eq(ResolutionCore.get_base_resolution(), ResolutionCore._base)
	assert_eq(ResolutionCore.get_window_size(), get_tree().root.size)
	assert_eq(ResolutionCore.get_fill_mode(), ResolutionCore._platform_fill_mode)


func test_core_node_processes_in_a_paused_tree() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	var node: Node = ResolutionCore._node
	assert_eq(node.process_mode, Node.PROCESS_MODE_ALWAYS)
	get_tree().paused = true
	# `TimeCore.set_paused(true)` and DEV step mode with budget 0 pause the tree; the end of a screen mode transition
	# does not wait for the pause to end.
	assert_true(node.can_process(), "the core node processes in a paused tree")


func test_core_node_destroyed_outside_release_cleans_up_like_release() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	var node: Node = ResolutionCore._node
	node.get_parent().remove_child(node)
	assert_false(ResolutionCore.is_initialized())
	assert_null(ResolutionCore._node)
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(node))
	assert_true(ResolutionCore.init())


func test_init_of_an_initialized_module_logs_an_error_and_fails() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	var node: Node = ResolutionCore._node
	assert_false(ResolutionCore.init())
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(ResolutionCore._node, node)
	assert_true(ResolutionCore.is_initialized())


func test_base_resolution_with_equal_sides_or_a_side_below_1_fails_init_with_an_error() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_dependencies())
	# The dependencies stay initialized: `LogCore.release` would clear the log listener of this test.
	var bases: Array[Vector2i] = [Vector2i(1080, 1080), Vector2i(0, 1080), Vector2i(1920, -1)]
	for base: Vector2i in bases:
		_SUPPORT.set_size_setting("baseResolution", base)
		assert_false(ResolutionCore.init(), str(base))
		assert_eq(_SUPPORT.errors(), 1, str(base))
		assert_false(ResolutionCore.is_initialized())
		assert_null(ResolutionCore._node)


func test_fill_color_without_3_elements_fails_init_with_an_error() -> void:
	_SUPPORT.set_common_settings()
	var color: Array[int] = [1, 2]
	UnitTestCore.set_test_settings("ResolutionCore.fillColor", color)
	assert_true(_SUPPORT.start_dependencies())
	assert_false(ResolutionCore.init())
	assert_eq(_SUPPORT.errors(), 1)


func test_operations_before_init_log_an_error_and_return_the_failure_value() -> void:
	assert_true(_SUPPORT.start_dependencies())
	assert_eq(ResolutionCore.get_orientation(), ResolutionCore.ScreenOrientation.LANDSCAPE)
	assert_eq(ResolutionCore.get_base_resolution(), Vector2i.ZERO)
	assert_eq(ResolutionCore.get_window_size(), Vector2i.ZERO)
	assert_eq(ResolutionCore.get_game_area(), Rect2())
	assert_eq(ResolutionCore.get_visible_game_area(), Rect2())
	assert_eq(ResolutionCore.get_scale(), 0.0)
	assert_eq(ResolutionCore.get_fill_mode(), ResolutionCore.FillMode.LETTERBOX)
	assert_eq(ResolutionCore.window_to_game(Vector2(10, 10)), Vector2.ZERO)
	assert_eq(ResolutionCore.game_to_window(Vector2(10, 10)), Vector2.ZERO)
	assert_false(ResolutionCore.is_screen_mode_supported())
	assert_eq(ResolutionCore.get_screen_mode(), ResolutionCore.ScreenMode.FULLSCREEN)
	assert_false(ResolutionCore.set_screen_mode(ResolutionCore.ScreenMode.WINDOWED))
	ResolutionCore.apply_saved_screen_mode()
	ResolutionCore.load_fill_image()
	ResolutionCoreDev.set_test_screen(_SUPPORT.BASE, Vector2i(1920, 1080), ResolutionCore.FillMode.LETTERBOX, true)
	assert_eq(_SUPPORT.errors(), 15)
	assert_false(ResolutionCore.is_initialized())
