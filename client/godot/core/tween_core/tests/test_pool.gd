extends "res://core/tween_core/tests/support/tween_test_case.gd"
## The `PoolCore` return cleaner of TweenCore.


func test_giving_back_a_pool_object_stops_the_tweens_of_it_and_under_it() -> void:
	start()
	var scope: Scope = ResourceCore.get_global_scope()
	await ResourceCore.load(POOL_OBJECT, ResourceCore.BaseKind.PACKED_SCENE, scope)
	var handle: Vector4i = PoolCore.borrow(POOL_OBJECT, scope)
	assert_true(PoolCore.is_valid(handle))
	var instance: Node = PoolCore.get_instance(handle)
	keep(instance)
	var sprite: Node2D = instance.get_child(0) as Node2D
	var tween: int = TweenCore.play(move(100), sprite, options())
	var other: int = TweenCore.play(move(100), node_2d(), options())
	await advance(50)
	PoolCore.give_back(handle)
	assert_false(TweenCore.is_playing(tween))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))
	assert_almost_eq(sprite.position.x, 50.0, 0.001, "the value stays")
	assert_true(TweenCore.is_playing(other))


func test_giving_back_stops_the_tweens_of_a_node_added_under_it_and_keeps_the_others_after_the_slots_grow() -> void:
	start()
	var scope: Scope = ResourceCore.get_global_scope()
	await ResourceCore.load(POOL_OBJECT, ResourceCore.BaseKind.PACKED_SCENE, scope)
	var others: Array[int] = []
	for i: int in 40:
		others.append(TweenCore.play(move(100), node_2d()))
	assert_gt(TweenCore._slot_count, 16, "the slots grew")
	var handle: Vector4i = PoolCore.borrow(POOL_OBJECT, scope)
	var instance: Node = PoolCore.get_instance(handle)
	keep(instance)
	var sprite: Node2D = instance.get_child(0) as Node2D
	var added: Node2D = Node2D.new()
	sprite.add_child(added)
	var sprite_tween: int = TweenCore.play(move(100), sprite, options())
	var added_tween: int = TweenCore.play(move(100), added, options())
	await advance(50)
	PoolCore.give_back(handle)
	assert_false(TweenCore.is_playing(sprite_tween))
	assert_false(TweenCore.is_playing(added_tween), "a node added under a constituent object")
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED, TweenCore.TweenEndReason.STOPPED]))
	for other: int in others:
		assert_true(TweenCore.is_playing(other))
	added.free()


func test_the_return_cleaner_on_a_node_without_children_stops_only_its_tweens() -> void:
	start()
	var leaf: Node2D = node_2d()
	var other: Node2D = node_2d()
	var moving: int = TweenCore.play(move(100), leaf, options())
	var scaling: int = TweenCore.play(single(change(TweenCore.TweenProperty.SCALE, Vector4(2, 2, 0, 0), 100)), leaf)
	var other_tween: int = TweenCore.play(move(100), other)
	assert_eq(TweenCore._on_pool_return(leaf), 0)
	assert_false(TweenCore.is_playing(moving))
	assert_false(TweenCore.is_playing(scaling))
	assert_true(TweenCore.is_playing(other_tween))
	assert_eq(recorder.reasons, PackedInt32Array([TweenCore.TweenEndReason.STOPPED]))


func test_target_operations_find_the_tweens_of_each_target_after_the_slots_grow() -> void:
	start()
	var targets: Array[Node2D] = []
	var handles: Array[int] = []
	for i: int in 40:
		var target: Node2D = node_2d()
		targets.append(target)
		handles.append(TweenCore.play(move(100), target))
	var replaced: int = TweenCore.play(move(200), targets[5])
	assert_false(TweenCore.is_playing(handles[5]), "the same property tween of the target stops")
	assert_true(TweenCore.is_playing(replaced))
	for i: int in 40:
		assert_eq(TweenCore.stop_target(targets[i]), 1)
	assert_eq(TweenCore._active_count, 0)
	assert_eq(TweenCore._property_count, 0)
