extends "res://core/tween_core/tests/support/tween_test_case.gd"
## Tween presets: loading, the tween preset kind, requests while a preset loads, and `TweenStartedEvent`.

const _FRAME_CALLER := preload("res://core/tween_core/tests/support/tween_test_frame_caller.gd")


## Waits until the load of the tween preset `key` has ended.
func load_end(key: String) -> void:
	await ResourceCore.load(key, TweenCore.get_preset_kind(), ResourceCore.get_global_scope())
	await frame_end()


func test_preset_plays_when_it_loaded_and_its_started_event_comes_then() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	assert_true(TweenCore.is_playing(handle), "playing while it loads")
	assert_eq(recorder.started_count, 0)
	await load_end(MOVE)
	assert_eq(recorder.started_count, 1)
	await advance(50)
	assert_almost_eq(target.position.x, 50.0, 0.001)
	await advance(50)
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	var loaded: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), node_2d(), options())
	assert_eq(recorder.started_count, 2, "a loaded preset starts in the operation")
	assert_true(TweenCore.is_playing(loaded))


func test_preset_stopped_while_it_loads_changes_nothing_after_the_load() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	TweenCore.stop(handle)
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))
	await load_end(MOVE)
	await advance(50)
	assert_eq(target.position, Vector2.ZERO)
	assert_eq(recorder.started_count, 0, "no started event for a preset stopped before it loaded")
	assert_eq(recorder.reasons.size(), 1)


func test_preset_of_a_missing_key_changes_nothing_and_completes() -> void:
	start()
	var target: Node2D = node_2d()
	var handle: int = TweenCore.play_preset(MISSING, ResourceCore.get_global_scope(), target, options())
	await frame_end()
	await frame_end()
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0)
	assert_false(TweenCore.is_playing(handle))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))
	assert_eq(target.position, Vector2.ZERO)


func test_request_on_the_target_of_a_loading_preset_stops_it_and_other_targets_do_not() -> void:
	start()
	var target: Node2D = node_2d()
	var loading: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	var scale: int = TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 1000)), target)
	assert_false(TweenCore.is_playing(loading))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))
	var other_target: Node2D = node_2d()
	var other: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), other_target, options())
	TweenCore.play(move(100), node_2d())
	assert_true(TweenCore.is_playing(other), "a request on another target does not end it")
	await load_end(MOVE)
	assert_true(TweenCore.is_playing(scale), "the load of the stopped preset does not end the later tween")
	await advance(50)
	assert_eq(target.position, Vector2.ZERO)
	assert_almost_eq(other_target.position.x, 50.0, 0.001)
	var replaced: int = TweenCore.play_preset(MISSING, ResourceCore.get_global_scope(), node_2d(), options())
	assert_true(TweenCore.is_playing(replaced))
	await frame_end()
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0)


func test_preset_requested_in_frame_code_plays_when_it_loaded() -> void:
	start()
	var target: Node2D = node_2d()
	var caller: _FRAME_CALLER = _FRAME_CALLER.new()
	caller.key = MOVE
	caller.target = target
	caller.options = options()
	keep(caller)
	await frame_end()
	assert_true(caller.called)
	assert_true(TweenCore.is_playing(caller.handle), "playing while it loads")
	await load_end(MOVE)
	assert_eq(recorder.started_count, 1)
	await advance(100)
	assert_eq(target.position, Vector2(100, 0))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.COMPLETED]))


func test_preset_released_before_its_load_starts_loads_nothing_in_the_next_session() -> void:
	start()
	var target: Node2D = node_2d()
	TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), target, options())
	TweenCore.release()
	assert_true(TweenCore.init())
	await frame_end()
	await frame_end()
	assert_false(ResourceCore.is_loaded(MOVE, TweenCore.get_preset_kind()), "the preset of the released session")
	assert_eq(target.position, Vector2.ZERO)
	assert_eq(recorder.started_count, 0)


func test_started_event_once_per_play_play_value_and_loaded_preset_and_none_for_invalid_requests() -> void:
	start()
	TweenCore.play(move(100), node_2d())
	assert_eq(recorder.started_count, 1, "play")
	TweenCore.play_value(TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4.ONE, move(100), recorder.on_float)
	assert_eq(recorder.started_count, 2, "play_value")
	TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), node_2d())
	var stopped: int = TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), node_2d())
	TweenCore.stop(stopped)
	assert_eq(TweenCore.play(move(100), null), 0)
	assert_eq(TweenCore.play_preset(MOVE, ResourceCore.get_global_scope(), null), 0)
	assert_eq(TweenCore.play_value(TweenCore.TweenValueKind.FLOAT, Vector4.ZERO, Vector4.ONE, null, recorder.on_float), 0)
	assert_eq(errors(), 3)
	await load_end(MOVE)
	assert_eq(recorder.started_count, 3, "the loaded preset, not the stopped one or the invalid requests")


func test_preset_kind_loads_a_tween_definition_and_a_missing_key_is_a_definition_without_step() -> void:
	start()
	var kind: int = TweenCore.get_preset_kind()
	var loaded: Resource = await ResourceCore.load(MOVE, kind, ResourceCore.get_global_scope())
	assert_true(loaded is TweenDefinition)
	var move_definition: TweenDefinition = loaded as TweenDefinition
	assert_eq(move_definition.steps.size(), 1)
	assert_eq(move_definition.steps[0].changes[0].target_value, Vector4(100, 0, 0, 0))
	var missing: Resource = await ResourceCore.load(MISSING, kind, ResourceCore.get_global_scope())
	assert_true(missing is TweenDefinition)
	assert_eq((missing as TweenDefinition).steps.size(), 0)
	assert_gt(UnitTestCore.check_logs(ERROR, "ResourceCore"), 0)
