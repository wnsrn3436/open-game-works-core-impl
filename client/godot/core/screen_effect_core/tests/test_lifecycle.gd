extends "res://core/screen_effect_core/tests/support/screen_effect_test_case.gd"
## Lifecycle: init check, release, init again and destruction of the core node outside release.


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(false))
	assert_false(ScreenEffectCore.is_initialized())
	assert_true(ScreenEffectCore.init())
	assert_true(ScreenEffectCore.is_initialized())
	ScreenEffectCore.release()
	assert_false(ScreenEffectCore.is_initialized())


func test_release_removes_overlays_and_init_again_completes_a_fade() -> void:
	assert_true(await start_modules())
	ScreenEffectCore.set_flash_opacity_limit(0.2)
	ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 1000)
	var overlays: Array[ColorRect] = ScreenEffectCore._overlays.duplicate()
	var node: Node = ScreenEffectCore._node
	assert_true(node.is_inside_tree())
	ScreenEffectCore.release()
	for index: int in overlays.size():
		assert_false(is_instance_valid(overlays[index]), "the overlay was destroyed")
	assert_false(node.is_inside_tree())
	assert_false(ScreenEffectCore._is_initialized)
	assert_null(ScreenEffectCore._node)
	assert_eq(ScreenEffectCore._max_duration_ms, 0)
	assert_eq(ScreenEffectCore._flash_limit, 1.0)
	assert_eq(ScreenEffectCore._overlays.size(), 0)
	assert_eq(ScreenEffectCore._current.size(), 0)
	assert_null(ScreenEffectCore._tween_options)
	assert_true(ScreenEffectCore.init())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 100)
	record(handle)
	await advance(200)
	assert_results([COMPLETED])


func test_operations_before_init_log_an_error() -> void:
	assert_true(await start_modules(false))
	var owner: Node = make_owner()
	assert_true(is_settled(ScreenEffectCore.fade(WORLD, owner, Color.WHITE, 0.0, 1.0, 0)))
	assert_true(is_settled(ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 0, 0, 0)))
	assert_true(is_settled(ScreenEffectCore.play_preset(WORLD, owner, make_definition([opacity_change(1.0, 0)]))))
	ScreenEffectCore.skip_to_end(null)
	ScreenEffectCore.clear_handle(null)
	ScreenEffectCore.clear_owner(owner)
	ScreenEffectCore.set_flash_opacity_limit(0.5)
	assert_eq(await ScreenEffectCore.wait_result(ScreenEffectHandle.new()), FAILED)
	assert_eq(ScreenEffectCoreDev.get_overlay_state(WORLD).visible, false)
	assert_results([FAILED, FAILED, FAILED])
	assert_eq(errors(), 12)
	assert_true(ScreenEffectCore.init())
	assert_false(ScreenEffectCore.init())
	assert_eq(errors(), 1)


func test_core_node_destroyed_outside_release_cleans_up_without_errors() -> void:
	assert_true(await start_modules())
	var handle: ScreenEffectHandle = ScreenEffectCore.fade(WORLD, make_owner(), Color.WHITE, 0.0, 1.0, 1000)
	record(handle)
	var overlays: Array[ColorRect] = ScreenEffectCore._overlays.duplicate()
	var node: Node = ScreenEffectCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(ScreenEffectCore.is_initialized())
	assert_results([CANCELLED])
	await UnitTestCore.wait_frames(1)
	for index: int in overlays.size():
		assert_false(is_instance_valid(overlays[index]), "the overlay was destroyed")
