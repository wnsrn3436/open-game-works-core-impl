extends PoolCoreTestCase
## Each row of the spec error table: the failure value and the log.


func test_prefab_without_on_borrow_and_on_return_fails_borrow_and_prefill_with_an_error() -> void:
	var scope: Scope = new_scope()
	for key: String in [NO_CALLBACKS, NOT_POOL_OBJECT]:
		await load_prefab(key, scope)
		assert_eq(PoolCore.borrow(key, scope), Vector4i.ZERO, key)
		assert_eq(errors(), 1, key)
		# A prefill count of 0 makes no instance and still fails the item.
		for count: int in [1, 0]:
			var prefill_scope: Scope = new_scope()
			assert_false(await PoolCore.prefill([item(key, prefill_scope, count)]), "%s %d" % [key, count])
			assert_eq(errors(), 1, "%s %d" % [key, count])
			assert_null(PoolCore._pool_of(key, prefill_scope), "%s %d" % [key, count])


func test_prefill_count_0_with_a_default_prefill_count_0_fails_a_prefab_without_on_borrow_and_on_return() -> void:
	PoolCore.release()
	assert_true(UnitTestCore.set_test_settings("PoolCore.defaultPrefillCount", 0))
	assert_true(PoolCore.init())
	var scope: Scope = new_scope()
	assert_false(await PoolCore.prefill([item(NO_CALLBACKS, scope)]))
	assert_eq(errors(), 1)
	assert_null(PoolCore._pool_of(NO_CALLBACKS, scope))
	assert_true(await PoolCore.prefill([item(EFFECT, scope)]))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	assert_not_null(PoolCore._pool_of(EFFECT, scope))


func test_fallback_prefab_fails_borrow_and_prefill_with_only_the_resource_core_log() -> void:
	var scope: Scope = new_scope()
	assert_eq(PoolCore.borrow(UNKNOWN, scope), Vector4i.ZERO)
	assert_eq(errors("ResourceCore"), 1)
	assert_eq(errors(), 0)
	# ResourceCore logs once per key, so prefill uses another unknown key.
	assert_false(await PoolCore.prefill([item(OTHER_UNKNOWN, scope, 1)]))
	assert_eq(errors("ResourceCore"), 1)
	assert_eq(errors(), 0)
	assert_eq(PoolCore.get_pool_state(UNKNOWN, scope), Vector2i.ZERO)
	assert_eq(PoolCore.get_pool_state(OTHER_UNKNOWN, scope), Vector2i.ZERO)


func test_borrow_from_a_released_pool_scope_is_the_empty_handle_with_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	release_scope(scope)
	assert_eq(PoolCore.borrow(EFFECT, scope), Vector4i.ZERO)
	assert_eq(errors(), 1)


func test_borrow_from_a_releasing_pool_scope_is_the_empty_handle_with_an_error() -> void:
	var scope: Scope = new_scope()
	var listener: Callable = func(released: Scope) -> void:
		if released == scope:
			assert_eq(PoolCore.borrow(EFFECT, scope), Vector4i.ZERO)
	await load_prefab(EFFECT, scope)
	ResourceCore.add_scope_release_listener(listener)
	release_scope(scope)
	ResourceCore.remove_scope_release_listener(listener)
	assert_eq(errors(), 1)


func test_owner_bound_borrow_with_a_destroyed_owner_or_an_owner_without_owner_scope_fails_and_keeps_the_count() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var borrowed: Vector4i = PoolCore.borrow(EFFECT, scope)
	var destroyed: Node2D = Node2D.new()
	destroyed.free()
	assert_eq(PoolCore.borrow(EFFECT, scope, destroyed), Vector4i.ZERO)
	assert_eq(errors(), 1)
	# A non-node object can not have an owner scope.
	assert_eq(PoolCore.borrow(EFFECT, scope, RefCounted.new()), Vector4i.ZERO)
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))
	assert_true(PoolCore.is_valid(borrowed))


func test_owner_bound_borrow_while_the_owner_object_is_destroyed_fails_and_keeps_the_count() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var borrowed: Vector4i = PoolCore.borrow(EFFECT, scope)
	var owner: Node2D = node_in_tree()
	var owner_scope: Scope = ResourceCore.get_owner_scope(owner)
	var handles: Array[Vector4i] = []
	var listener: Callable = func(released: Scope) -> void:
		if released == owner_scope:
			handles.append(PoolCore.borrow(EFFECT, scope, owner))
	ResourceCore.add_scope_release_listener(listener)
	owner.free()
	ResourceCore.remove_scope_release_listener(listener)
	assert_eq(handles, [Vector4i.ZERO] as Array[Vector4i])
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))
	assert_true(PoolCore.is_valid(borrowed))
	await UnitTestCore.wait_frames(2)


func test_owner_bound_borrow_with_a_releasing_owner_scope_of_common_cleanup_fails_and_keeps_the_count() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var parent_handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var socket: Node = instance_of(parent_handle).get_node("Socket")
	var socket_scope: Scope = ResourceCore.get_owner_scope(socket)
	var handles: Array[Vector4i] = []
	var states: Array[Vector2i] = []
	var listener: Callable = func(released: Scope) -> void:
		if released == socket_scope:
			states.append(PoolCore.get_pool_state(EFFECT, scope))
			handles.append(PoolCore.borrow(EFFECT, scope, socket))
			states.append(PoolCore.get_pool_state(EFFECT, scope))
	ResourceCore.add_scope_release_listener(listener)
	PoolCore.give_back(parent_handle)
	ResourceCore.remove_scope_release_listener(listener)
	assert_eq(handles, [Vector4i.ZERO] as Array[Vector4i])
	assert_eq(states.size(), 2)
	assert_eq(states[0], states[1], "the borrow keeps the count")
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(2, 0))


func test_prefill_item_with_a_released_pool_scope_fails_with_an_error() -> void:
	var scope: Scope = new_scope()
	release_scope(scope)
	var other: Scope = new_scope()
	assert_false(await PoolCore.prefill([item(EFFECT, scope, 1), item(EFFECT, other, 1)]))
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, other), Vector2i(1, 0))


func test_give_back_and_get_instance_of_a_handle_that_is_not_valid_log_an_error_and_the_empty_handle_does_not() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	PoolCore.give_back(handle)
	assert_eq(errors(), 1)
	assert_null(PoolCore.get_instance(handle))
	assert_eq(errors(), 1)
	assert_eq(instance.return_count, 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
	PoolCore.give_back(Vector4i.ZERO)
	assert_null(PoolCore.get_instance(Vector4i.ZERO))


func test_double_return_does_nothing_and_logs_an_error() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(AUTO_EFFECT, scope))
	PoolCore.notify_finished(instance)
	PoolCore.notify_finished(instance)
	assert_eq(errors(), 1)
	assert_eq(instance.return_count, 1)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))


func test_notify_finished_of_a_manual_return_instance_or_an_instance_not_made_by_pool_core_is_ignored_with_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope))
	PoolCore.notify_finished(instance)
	assert_eq(errors(), 1)
	var stranger: PoolCoreTestObject = PoolCoreTestObject.new()
	_nodes.append(stranger)
	stranger.auto_return = true
	PoolCore.notify_finished(stranger)
	assert_eq(errors(), 1)
	PoolCore.notify_finished(node_in_tree())
	assert_eq(errors(), 1)
	assert_eq(instance.return_count, 0)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))


func test_prefill_count_over_the_maximum_counts_as_the_maximum_with_a_warning() -> void:
	var scope: Scope = new_scope()
	assert_true(await PoolCore.prefill([item(EFFECT, scope, MAX_POOL_SIZE + 1)]))
	assert_eq(warnings(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(MAX_POOL_SIZE, 0))
	assert_eq(PoolCore._pool_of(EFFECT, scope).prefill_count, MAX_POOL_SIZE)


func test_adding_a_registered_return_cleaner_again_is_ignored() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	PoolCore.add_return_cleaner(counting_cleaner)
	PoolCore.add_return_cleaner(counting_cleaner)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	var clean_count: int = cleaned.get(instance.get_instance_id(), 0)
	assert_eq(clean_count, 1)
	assert_eq(PoolCore._cleaners.size(), 1)
