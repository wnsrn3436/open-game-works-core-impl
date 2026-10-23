extends UnitTestCase
## Lifecycle of `QualityCore`: init check, the state `release` puts back, the core node, a second `init`, and the
## operations before `init`.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_init_check_before_init_after_init_and_after_release() -> void:
	assert_false(QualityCore.is_initialized())
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	assert_true(QualityCore.is_initialized())
	QualityCore.release()
	assert_false(QualityCore.is_initialized())


func test_release_puts_every_static_var_back_and_removes_the_core_node() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	QualityCoreDev.set_test_device_info(1, 1, 60)
	QualityCore.apply_saved_level()
	QualityCore.set_level(QualityCore.QualityLevel.LOW)
	QualityCoreDev.set_test_level(QualityCore.QualityLevel.MEDIUM)
	var node: Node = QualityCore._node
	assert_true(node.is_inside_tree())
	QualityCore.release()
	assert_false(node.is_inside_tree())
	assert_false(QualityCore._is_initialized)
	assert_null(QualityCore._session)
	assert_null(QualityCore._node)
	assert_true(QualityCore._profiles.is_empty())
	assert_true(QualityCore._class_levels.is_empty())
	assert_true(QualityCore._class_memory.is_empty())
	assert_true(QualityCore._class_processors.is_empty())
	assert_false(QualityCore._auto_enabled)
	assert_eq(QualityCore._window_ms, 0)
	assert_eq(QualityCore._fps_permille, 0)
	assert_eq(QualityCore._hitch_ms, 0)
	assert_eq(QualityCore._level, QualityCore.QualityLevel.MEDIUM)
	assert_false(QualityCore._override)
	assert_false(QualityCore._applied)
	assert_eq(QualityCore._initial_render_scale, 1.0)
	assert_eq(QualityCore._initial_max_fps, 0)
	assert_false(QualityCore._shadow_off)
	assert_true(QualityCore._light_shadows.is_empty())
	assert_false(QualityCore._in_background)
	assert_eq(QualityCore._measured_frames, 0)
	assert_eq(QualityCore._measured_ms, 0)
	assert_false(QualityCore._downgrade_call.is_valid())
	assert_false(QualityCore._test_level_active)
	assert_false(QualityCore._test_device_active)
	assert_eq(QualityCore._test_memory_bytes, -1)
	assert_eq(QualityCore._test_processor_count, -1)
	assert_eq(QualityCore._test_refresh_rate, -1)


func test_init_after_release_works_as_the_first_init_and_keeps_the_saved_values() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(QualityCore.QualityLevel.LOW)
	QualityCore.release()
	assert_true(QualityCore.init())
	assert_eq(QualityCore.get_level(), QualityCore.QualityLevel.MEDIUM, "the level before apply_saved_level")
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "Low", "release keeps the saved values")


func test_core_node_destroyed_outside_release_cleans_up_like_release() -> void:
	_SUPPORT.set_common_settings()
	var max_fps: int = Engine.max_fps
	assert_true(_SUPPORT.start_applied())
	QualityCore.set_level(QualityCore.QualityLevel.LOW)
	var node: Node = QualityCore._node
	node.free()
	assert_false(QualityCore.is_initialized())
	assert_null(QualityCore._node)
	assert_eq(Engine.max_fps, max_fps, "engine values are back")
	assert_true(QualityCore.init())


func test_core_node_taken_out_of_the_tree_is_freed() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	var node: Node = QualityCore._node
	node.get_parent().remove_child(node)
	assert_false(QualityCore.is_initialized())
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(node))
	assert_true(QualityCore.init())


func test_init_of_an_initialized_module_logs_an_error_and_fails() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	var node: Node = QualityCore._node
	assert_false(QualityCore.init())
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(QualityCore._node, node)
	assert_true(QualityCore.is_initialized())


func test_operations_before_init_log_an_error_and_return_the_failure_value() -> void:
	assert_true(_SUPPORT.start_dependencies())
	assert_eq(QualityCore.get_level(), QualityCore.QualityLevel.MEDIUM)
	var profile: QualityProfile = QualityCore.get_profile()
	assert_eq(profile.render_scale_permille, 1000)
	assert_eq(profile.shadow, QualityCore.ShadowQuality.HIGH)
	assert_eq(profile.effect_density_permille, 1000)
	assert_eq(profile.frame_limit_fps, 0)
	assert_false(QualityCore.is_override())
	assert_false(QualityCore.set_level(QualityCore.QualityLevel.HIGH))
	QualityCore.clear_override()
	QualityCore.apply_saved_level()
	QualityCoreDev.set_test_level(QualityCore.QualityLevel.HIGH)
	QualityCoreDev.set_test_device_info(1, 1, 60)
	assert_eq(_SUPPORT.errors(), 8)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "", "set_level before init saves nothing")
	assert_false(QualityCore.is_initialized())


func test_get_profile_before_init_gives_the_failure_value_with_an_error() -> void:
	assert_true(_SUPPORT.start_dependencies())
	var profile: QualityProfile = QualityCore.get_profile()
	assert_eq(profile.render_scale_permille, 1000)
	assert_eq(profile.shadow, QualityCore.ShadowQuality.HIGH)
	assert_eq(profile.effect_density_permille, 1000)
	assert_eq(profile.frame_limit_fps, 0)
	assert_eq(_SUPPORT.errors(), 1)
