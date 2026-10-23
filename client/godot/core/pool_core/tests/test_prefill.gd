extends PoolCoreTestCase
## `prefill`, borrowing from a pool that does not exist and the memory warning.


func test_prefill_of_an_empty_pool_makes_the_prefill_count_the_default_or_the_maximum() -> void:
	var given: Scope = new_scope()
	var omitted: Scope = new_scope()
	var over: Scope = new_scope()
	assert_true(await PoolCore.prefill([item(EFFECT, given, 1)]))
	assert_eq(PoolCore.get_pool_state(EFFECT, given), Vector2i(1, 0))
	assert_true(await PoolCore.prefill([item(EFFECT, omitted)]))
	assert_eq(PoolCore.get_pool_state(EFFECT, omitted), Vector2i(DEFAULT_PREFILL_COUNT, 0))
	assert_true(await PoolCore.prefill([item(EFFECT, over, MAX_POOL_SIZE + 2)]))
	assert_eq(warnings(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, over), Vector2i(MAX_POOL_SIZE, 0))


func test_prefill_of_a_fuller_pool_does_not_shrink_it() -> void:
	var scope: Scope = await filled_scope(EFFECT, MAX_POOL_SIZE)
	assert_true(await PoolCore.prefill([item(EFFECT, scope, 1)]))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(MAX_POOL_SIZE, 0))
	assert_eq(PoolCore._pool_of(EFFECT, scope).prefill_count, 1)


func test_prefill_fills_the_other_items_when_one_fails() -> void:
	var scope: Scope = new_scope()
	var items: Array[PrefillItem] = [item(UNKNOWN, scope, 1), item(EFFECT, scope, 1), item(AUTO_EFFECT, scope, 2)]
	assert_false(await PoolCore.prefill(items))
	assert_eq(errors("ResourceCore"), 1)
	assert_eq(PoolCore.get_pool_state(UNKNOWN, scope), Vector2i.ZERO)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(2, 0))


func test_borrow_from_no_pool_makes_the_pool_when_the_prefab_is_in_the_cache() -> void:
	assert_true(CoreBuildInfo.has_dev_code)
	var scope: Scope = new_scope()
	await load_prefab(EFFECT, scope)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	assert_true(PoolCore.is_valid(handle))
	assert_eq(warnings(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))
	assert_not_null(PoolCore._pool_of(EFFECT, scope))


func test_borrow_from_no_pool_without_the_prefab_in_the_cache_is_the_empty_handle_with_only_a_resource_core_error() -> void:
	var scope: Scope = new_scope()
	assert_eq(PoolCore.borrow(EFFECT, scope), Vector4i.ZERO)
	assert_eq(errors("ResourceCore"), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	assert_null(PoolCore._pool_of(EFFECT, scope))


func test_memory_warning_destroys_the_instances_over_each_prefill_count() -> void:
	var prefilled: Scope = await filled_scope(EFFECT, 1)
	var handles: Array[Vector4i] = []
	for i: int in MAX_POOL_SIZE:
		handles.append(PoolCore.borrow(EFFECT, prefilled))
	for handle: Vector4i in handles:
		PoolCore.give_back(handle)
	assert_eq(PoolCore.get_pool_state(EFFECT, prefilled), Vector2i(MAX_POOL_SIZE, 0))
	var never_prefilled: Scope = new_scope()
	await load_prefab(AUTO_EFFECT, never_prefilled)
	var auto_handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, never_prefilled)
	PoolCore.give_back(auto_handle)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, never_prefilled), Vector2i(1, 0))
	PoolCore._node.notification(Node.NOTIFICATION_OS_MEMORY_WARNING)
	assert_eq(PoolCore.get_pool_state(EFFECT, prefilled), Vector2i(1, 0))
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, never_prefilled), Vector2i.ZERO)


func test_prefill_whose_pool_scope_is_released_while_it_waits_for_the_prefab_fails_without_log() -> void:
	var scope: Scope = new_scope()
	var prefill_run: PoolCoreTestPrefillRun = start_prefill([item(EFFECT, scope, 2)])
	assert_false(prefill_run.done)
	release_scope(scope)
	assert_false(await prefill_run.wait())
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	assert_null(PoolCore._pool_of(EFFECT, scope))
