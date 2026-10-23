extends "res://core/tween_core/tests/support/tween_test_case.gd"
## `init`, `release`, the core node and the operations before `init` and after `release`.


func test_release_ends_tweens_without_callback_lifts_blocks_and_wait_end_gets_none() -> void:
	start()
	var target: Node2D = node_2d()
	var playing: int = TweenCore.play(move(100), target, options("", true))
	var loading_target: Node2D = node_2d()
	var loading: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), loading_target, options("", true))
	recorder.wait(playing, 0)
	recorder.wait(loading, 1)
	var kind: int = TweenCore.get_preset_kind()
	await advance(50)
	assert_eq(tween_blocks(), 2)
	TweenCore.release()
	assert_eq(recorder.waits, {0: TweenCore.TweenEndReason.NONE, 1: TweenCore.TweenEndReason.NONE})
	assert_eq(recorder.reasons.size(), 0, "no callback")
	assert_eq(tween_blocks(), 0)
	assert_almost_eq(target.position.x, 50.0, 0.001, "the values stay")
	await ResourceCore.load(MOVE, kind, ResourceCore.get_global_scope())
	await advance(100)
	assert_eq(loading_target.position, Vector2.ZERO, "the loading preset does not start")
	assert_true(TweenCore.init())
	var again: int = TweenCore.play(move(100), target, options())
	await advance(100)
	assert_false(TweenCore.is_playing(again))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_lifecycle() -> void:
	assert_false(TweenCore.is_initialized())
	start()
	assert_true(TweenCore.is_initialized())
	assert_false(TweenCore.init())
	assert_eq(errors(), 1)
	var node: Node = TweenCore._node
	assert_true(node.is_inside_tree())
	assert_eq(node.process_mode, Node.PROCESS_MODE_ALWAYS)
	TweenCore.play(move(100), node_2d(), options("tag", true))
	TweenCore.play_value(TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4.ONE, move(0), recorder.on_float)
	TweenCore.release()
	assert_false(TweenCore.is_initialized())
	assert_false(node.is_inside_tree())
	_assert_initial_state()
	assert_true(TweenCore.init())
	assert_true(TweenCore.is_initialized())


func test_core_node_exit_tree_releases() -> void:
	start()
	TweenCore.play(move(100), node_2d(), options("", true))
	TweenCore._node.free()
	assert_false(TweenCore.is_initialized())
	_assert_initial_state()
	assert_eq(tween_blocks(), 0)
	assert_eq(recorder.reasons.size(), 0)
	assert_true(TweenCore.init())


func test_init_fails_without_resource_core_and_pool_core() -> void:
	ResourceCoreDev.set_test_key_list({})
	assert_true(LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init())
	assert_false(TweenCore.init())
	assert_eq(errors(), 1)
	assert_false(TweenCore.is_initialized())
	_assert_initial_state()
	assert_true(ResourceCore.init() and PoolCore.init() and InputBlockCore.init())
	assert_true(TweenCore.init())


func test_operations_before_init_and_after_release_fail_with_an_error_log() -> void:
	ResourceCoreDev.set_test_key_list({})
	assert_true(LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init())
	assert_true(ResourceCore.init() and PoolCore.init() and InputBlockCore.init())
	await _assert_operations_fail()
	assert_true(TweenCore.init())
	TweenCore.release()
	await _assert_operations_fail()


func _assert_operations_fail() -> void:
	var target: Node2D = node_2d()
	var scope: Scope = ResourceCore.get_global_scope()
	assert_eq(TweenCore.play(move(), target), 0)
	assert_eq(TweenCore.play_preset(MOVE, scope, target), 0)
	assert_eq(TweenCore.play_value(TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4.ONE, move(), _noop), 0)
	TweenCore.stop(1 << 20)
	TweenCore.skip_to_end(1 << 20)
	assert_eq(TweenCore.stop_target(target), 0)
	assert_eq(TweenCore.skip_target_to_end(target), 0)
	assert_eq(TweenCore.stop_tag("tag"), 0)
	assert_eq(TweenCore.skip_tag_to_end("tag"), 0)
	assert_false(TweenCore.is_playing(1 << 20))
	var reason: TweenCore.TweenEndReason = await TweenCore.wait_end(1 << 20)
	assert_eq(reason, TweenCore.TweenEndReason.NONE)
	assert_false(TweenCore.copy_definition(move(), TweenDefinition.new()))
	assert_eq(TweenCore.get_preset_kind(), -1)
	assert_false(TweenCore.check_definition(move(), target))
	assert_eq(TweenCore.evaluate_easing(TweenCore.Easing.LINEAR, 0.5), 0.0)
	assert_eq(errors(), 15)
	assert_eq(target.position, Vector2.ZERO)


func _noop(_value: float) -> void:
	pass


func _assert_initial_state() -> void:
	assert_false(TweenCore._is_initialized)
	assert_null(TweenCore._session)
	assert_null(TweenCore._node)
	assert_eq(TweenCore._max_duration_ms, 0)
	assert_eq(TweenCore._max_repeat_count, 0)
	assert_eq(TweenCore._preset_kind, -1)
	assert_null(TweenCore._default_options)
	assert_true(TweenCore._flush.is_null())
	assert_true(TweenCore._load_preset_call.is_null())
	assert_false(TweenCore._flush_queued)
	assert_null(TweenCore._flush_session)
	assert_eq(TweenCore._slot_count, 0)
	assert_eq(TweenCore._generation.size(), 0)
	assert_eq(TweenCore._active.size(), 0)
	assert_eq(TweenCore._records.size(), 0)
	assert_eq(TweenCore._free_slots.size(), 0)
	assert_eq(TweenCore._free_count, 0)
	assert_eq(TweenCore._active_count, 0)
	assert_eq(TweenCore._bucket_first.size(), 0)
	assert_eq(TweenCore._target_next.size(), 0)
	assert_eq(TweenCore._target_prev.size(), 0)
	assert_eq(TweenCore._property_slots.size(), 0)
	assert_eq(TweenCore._property_index.size(), 0)
	assert_eq(TweenCore._property_count, 0)
	assert_eq(TweenCore._end_handles.size(), 0)
	assert_eq(TweenCore._end_top, 0)
