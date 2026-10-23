extends "res://core/message_core/tests/support/message_test_case.gd"
## Lifecycle: init check, release, init again and destruction of the core node outside release.


func test_is_initialized_before_init_after_init_and_after_release() -> void:
	assert_true(await start_modules(false))
	assert_false(MessageCore.is_initialized())
	assert_true(MessageCore.init())
	assert_true(MessageCore.is_initialized())
	MessageCore.release()
	assert_false(MessageCore.is_initialized())


func test_release_puts_static_vars_back_and_takes_core_node_out_of_tree() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_toast(key_b())
	MessageCore.show_black_box(key_a())
	var node: Node = MessageCore._node
	var black_box_object: Control = MessageCore._black_box_object
	assert_true(node.is_inside_tree())
	MessageCore.release()
	assert_false(node.is_inside_tree())
	assert_false(is_instance_valid(black_box_object))
	assert_false(MessageCore._is_initialized)
	assert_null(MessageCore._session)
	assert_null(MessageCore._node)
	assert_eq(MessageCore._prepare_state, MessageCore._PREPARE_NONE)
	assert_eq(MessageCore._toast_resource, "")
	assert_eq(MessageCore._black_box_resource, "")
	assert_eq(MessageCore._dim_opacity, 0.0)
	assert_eq(MessageCore._block_max_duration_ms, 0)
	assert_true(MessageCore._settings_ok)
	assert_null(MessageCore._toast)
	assert_null(MessageCore._black_box)
	assert_null(MessageCore._toast_holder)
	assert_null(MessageCore._black_box_holder)
	assert_null(MessageCore._scope)
	assert_null(MessageCore._toast_prefab)
	assert_null(MessageCore._black_box_prefab)
	assert_null(MessageCore._black_box_object)
	assert_null(MessageCore._black_box_label)
	assert_null(MessageCore._code_toast_object)
	assert_null(MessageCore._code_toast_label)
	assert_null(MessageCore._pass_list)
	assert_null(MessageCore._tween_options)
	var pool: Vector2i = PoolCore.get_pool_state(TOAST, ResourceCore.get_global_scope())
	assert_eq(pool.y, 0, "release gives the borrowed toast object back")
	assert_false(InputBlockCore.is_blocked())


func test_operations_before_init_log_an_error() -> void:
	assert_true(await start_modules(false))
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	MessageCore.close_black_box()
	MessageCore.close_all()
	assert_false(await MessageCore.prepare())
	assert_eq(errors(MessageCore._TAG), 5)
	assert_true(MessageCore.init())
	assert_false(MessageCore.init())
	assert_eq(errors(MessageCore._TAG), 1)


func test_init_and_prepare_after_release_show_toast_and_black_box_in_display_order() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_black_box(key_a())
	MessageCore.release()
	assert_true(MessageCore.init())
	assert_true(await MessageCore.prepare())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_b())
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.ENTER)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.ENTER)
	await advance(TWEEN_MS)
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.HOLD)
	await advance(TOAST_MS)
	assert_eq(toast().phase, MessageCore._KIND_STATE.Phase.EXIT)
	await advance(TWEEN_MS)
	assert_nothing_shown(toast())
	await advance(BLACK_BOX_MS - TOAST_MS - TWEEN_MS)
	assert_eq(black_box().phase, MessageCore._KIND_STATE.Phase.EXIT)
	await advance(TWEEN_MS)
	assert_nothing_shown(black_box())


func test_core_node_destroyed_outside_release_cleans_up_without_errors() -> void:
	use_prefabs_with_tweens()
	assert_true(await start_prepared())
	MessageCore.show_toast(key_a())
	MessageCore.show_black_box(key_a())
	var node: Node = MessageCore._node
	node.get_parent().remove_child(node)
	node.free()
	assert_false(MessageCore.is_initialized())
	assert_false(InputBlockCore.is_blocked())
	await UnitTestCore.wait_frames(1)
	var pool: Vector2i = PoolCore.get_pool_state(TOAST, ResourceCore.get_global_scope())
	assert_eq(pool.y, 0)
