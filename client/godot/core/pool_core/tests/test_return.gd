extends PoolCoreTestCase
## Handles, the return order and common cleanup, the pool size limit, auto-return and `EffectSpawnedEvent`.


func test_is_valid_is_true_before_return_and_false_after_and_for_the_empty_handle() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	assert_true(PoolCore.is_valid(handle))
	var instance: Node = PoolCore.get_instance(handle)
	assert_not_null(instance)
	PoolCore.give_back(handle)
	assert_false(PoolCore.is_valid(handle))
	assert_false(PoolCore.is_valid(Vector4i.ZERO))
	# The same instance lent again gets a new handle; the old one stays not valid.
	var again: Vector4i = PoolCore.borrow(EFFECT, scope)
	assert_true(PoolCore.is_valid(again))
	assert_false(PoolCore.is_valid(handle))
	assert_eq(PoolCore.get_instance(again), instance)


func test_returned_instance_is_detached_hidden_at_its_made_position_unsubscribed_and_cleaned_once_per_part() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	PoolCore.add_return_cleaner(counting_cleaner)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	var root: Node2D = node_2d(instance)
	assert_true(root.visible)
	var parent: Node2D = node_in_tree()
	parent.add_child(instance)
	root.position = Vector2(100, 200)
	var part: PoolCoreTestPart = instance.get_node("Part") as PoolCoreTestPart
	assert_true(EventCore.subscribe(EffectSpawnedEvent, part.on_effect_spawned))
	PoolCore.give_back(handle)
	assert_null(instance.get_parent())
	assert_false(root.visible)
	assert_eq(root.position, Vector2(5, 6))
	assert_eq(EventCore.count_subscriptions(part), 0)
	assert_eq(instance.return_count, 1)
	# Constituent objects: the root, Part and Socket.
	assert_eq(cleaned.size(), 3)
	for id: int in [instance.get_instance_id(), part.get_instance_id(), instance.get_node("Socket").get_instance_id()]:
		var clean_count: int = cleaned.get(id, 0)
		assert_eq(clean_count, 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))


func test_borrow_shows_the_instance_again_and_calls_on_borrow() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	handle = PoolCore.borrow(EFFECT, scope)
	assert_eq(instance_of(handle), instance)
	assert_true(node_2d(instance).visible)
	assert_eq(instance.borrow_count, 2)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))


func test_leak_check_logs_an_error_when_a_return_cleaner_leaves_an_item() -> void:
	assert_true(CoreBuildInfo.has_dev_code)
	var scope: Scope = await filled_scope(EFFECT, 1)
	cleaner_result = 1
	PoolCore.add_return_cleaner(counting_cleaner)
	PoolCore.give_back(PoolCore.borrow(EFFECT, scope))
	assert_eq(errors(), 1)


func test_give_back_to_a_full_pool_destroys_the_instance() -> void:
	var scope: Scope = await filled_scope(EFFECT, MAX_POOL_SIZE)
	var handles: Array[Vector4i] = []
	for i: int in MAX_POOL_SIZE + 1:
		handles.append(PoolCore.borrow(EFFECT, scope))
	assert_eq(warnings(), 1)
	for i: int in MAX_POOL_SIZE - 1:
		PoolCore.give_back(handles[i])
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(MAX_POOL_SIZE - 1, 2))
	# MAX_POOL_SIZE - 1 in the pool: kept.
	PoolCore.give_back(handles[MAX_POOL_SIZE - 1])
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(MAX_POOL_SIZE, 1))
	# MAX_POOL_SIZE in the pool: destroyed.
	var last: PoolCoreTestObject = instance_of(handles[MAX_POOL_SIZE])
	PoolCore.give_back(handles[MAX_POOL_SIZE])
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(MAX_POOL_SIZE, 0))
	assert_eq(last.return_count, 1)
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(last))


func test_notify_finished_takes_back_an_auto_return_instance() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	node_in_tree().add_child(instance)
	PoolCore.notify_finished(instance)
	assert_false(PoolCore.is_valid(handle))
	assert_eq(instance.return_count, 1)
	assert_null(instance.get_parent())
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))
	# The borrower can give an auto-return instance back before it ends.
	handle = PoolCore.borrow(AUTO_EFFECT, scope)
	PoolCore.give_back(handle)
	assert_eq(instance.return_count, 2)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))


func test_auto_return_member_is_manual_by_default_and_read_once_when_made() -> void:
	var unchanged: PoolCoreTestObject = PoolCoreTestObject.new()
	assert_false(unchanged.auto_return)
	unchanged.free()
	var scope: Scope = await filled_scope(EFFECT, 1)
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope))
	PoolCore.notify_finished(instance)
	assert_eq(errors(), 1)
	instance.auto_return = true
	PoolCore.notify_finished(instance)
	assert_eq(errors(), 1)
	assert_eq(instance.return_count, 0)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))
	# An auto-return instance made auto-return stays auto-return after the member changes.
	var auto_scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	var auto_instance: PoolCoreTestObject = instance_of(PoolCore.borrow(AUTO_EFFECT, auto_scope))
	auto_instance.auto_return = false
	PoolCore.notify_finished(auto_instance)
	assert_eq(auto_instance.return_count, 1)


func test_effect_spawned_event_comes_once_per_auto_return_borrow_only() -> void:
	var counter: PoolCoreTestCounter = PoolCoreTestCounter.new()
	_nodes.append(counter)
	assert_true(EventCore.subscribe(EffectSpawnedEvent, counter.on_effect_spawned))
	var auto_scope: Scope = await filled_scope(AUTO_EFFECT, 2)
	var manual_scope: Scope = await filled_scope(EFFECT, 1)
	PoolCore.borrow(AUTO_EFFECT, auto_scope)
	assert_eq(counter.count, 1)
	PoolCore.borrow(AUTO_EFFECT, auto_scope)
	assert_eq(counter.count, 2)
	PoolCore.borrow(EFFECT, manual_scope)
	assert_eq(counter.count, 2)
	assert_eq(PoolCore.borrow(UNKNOWN, auto_scope), Vector4i.ZERO)
	assert_eq(errors("ResourceCore"), 1)
	assert_eq(counter.count, 2)
	EventCore.unsubscribe_all(counter)
