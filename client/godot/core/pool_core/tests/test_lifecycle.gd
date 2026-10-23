extends PoolCoreTestCase
## `init`, `release`, teardown without `release` and calls outside `init`.


func test_release_destroys_every_pool_object_without_log_and_puts_every_static_var_back() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var borrowed: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, node_in_tree()))
	node_in_tree().add_child(borrowed)
	var pooled_handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var pooled: PoolCoreTestObject = instance_of(pooled_handle)
	PoolCore.give_back(pooled_handle)
	PoolCore.add_return_cleaner(counting_cleaner)
	var node: Node = PoolCore._node
	assert_true(is_instance_valid(node) and node.is_inside_tree())
	PoolCore.release()
	assert_false(PoolCore.is_initialized())
	_assert_initial_state()
	assert_false(node.is_inside_tree())
	assert_eq(borrowed.return_count, 0)
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(borrowed))
	assert_false(is_instance_valid(pooled))
	# A released scope does not reach a released PoolCore.
	release_scope(scope)


func test_init_after_release_works_like_the_first_init() -> void:
	PoolCore.release()
	assert_false(PoolCore.is_initialized())
	assert_true(PoolCore.init())
	assert_true(PoolCore.is_initialized())
	var scope: Scope = await filled_scope(EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	assert_true(PoolCore.is_valid(handle))
	PoolCore.give_back(handle)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))


func test_tree_teardown_without_release_clears_like_release() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var pooled_handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var pooled: PoolCoreTestObject = instance_of(pooled_handle)
	PoolCore.give_back(pooled_handle)
	PoolCore._node.free()
	assert_false(PoolCore.is_initialized())
	_assert_initial_state()
	# The pool objects without a parent are freed at once.
	assert_false(is_instance_valid(pooled))
	assert_true(PoolCore.init())


func test_init_of_an_initialized_module_fails() -> void:
	assert_false(PoolCore.init())
	assert_eq(errors(), 1)
	assert_true(PoolCore.is_initialized())


func test_operations_outside_init_return_failure_values_with_an_error_each() -> void:
	var scope: Scope = new_scope()
	await load_prefab(EFFECT, scope)
	PoolCore.release()
	assert_false(await PoolCore.prefill([item(EFFECT, scope, 1)]))
	assert_eq(PoolCore.borrow(EFFECT, scope), Vector4i.ZERO)
	PoolCore.give_back(Vector4i(1, 0, 0, 0))
	PoolCore.notify_finished(node_in_tree())
	assert_false(PoolCore.is_valid(Vector4i.ZERO))
	assert_null(PoolCore.get_instance(Vector4i.ZERO))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	PoolCore.add_return_cleaner(counting_cleaner)
	assert_eq(errors(), 8)
	assert_true(PoolCore._cleaners.is_empty())


func test_release_with_a_prefill_waiting_ends_it_with_false() -> void:
	var scope: Scope = new_scope()
	var prefill_run: PoolCoreTestPrefillRun = start_prefill([item(EFFECT, scope, 1)])
	assert_false(prefill_run.done)
	PoolCore.release()
	assert_true(prefill_run.done)
	assert_false(await prefill_run.wait())
	assert_true(PoolCore.init())
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)


func _assert_initial_state() -> void:
	assert_null(PoolCore._session)
	assert_null(PoolCore._node)
	assert_eq(PoolCore._default_prefill_count, 0)
	assert_eq(PoolCore._max_pool_size, 0)
	assert_false(PoolCore._listener.is_valid())
	assert_true(PoolCore._scope_pools.is_empty())
	assert_true(PoolCore._owner_bindings.is_empty())
	assert_true(PoolCore._cleaners.is_empty())
	assert_eq(PoolCore._ending_owner_ids.size(), 0)
	assert_eq(PoolCore._ending_count, 0)
	assert_eq(PoolCore._pending_scope_ids.size(), 0)
	assert_eq(PoolCore._pending_keys.size(), 0)
	assert_false(PoolCore._flush_scheduled)
	assert_true(PoolCore._waiters.is_empty())
