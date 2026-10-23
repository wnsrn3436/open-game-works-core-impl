extends PoolCoreTestCase
## Pool scope release, owner-bound borrows and pool objects destroyed outside PoolCore.


func test_releasing_a_pool_scope_with_borrowed_instances_takes_them_back_and_destroys_the_pool() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var first: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope))
	var second: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope))
	assert_eq(warnings(), 1)
	node_in_tree().add_child(first)
	release_scope(scope)
	assert_eq(errors(), 1)
	assert_eq(first.return_count, 1)
	assert_eq(second.return_count, 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	assert_null(PoolCore._pool_of(EFFECT, scope))
	assert_false(PoolCore._scope_pools.has(scope.get_instance_id()))
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(first))
	assert_false(is_instance_valid(second))


func test_releasing_a_pool_scope_without_borrowed_instances_destroys_its_pool_objects_without_log() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	release_scope(scope)
	assert_eq(instance.return_count, 1)
	assert_null(PoolCore._pool_of(EFFECT, scope))
	await UnitTestCore.wait_frames(1)
	assert_false(is_instance_valid(instance))


func test_destroying_a_borrowed_and_a_pooled_instance_outside_pool_core_logs_errors_and_drops_them() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var borrowed: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope))
	borrowed.free()
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var pooled: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
	pooled.free()
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)


func test_owner_destroy_takes_back_an_instance_outside_the_owner_and_drops_one_under_it() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var owner: Node2D = node_in_tree()
	var outside_handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var under_handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var outside: PoolCoreTestObject = instance_of(outside_handle)
	var under: PoolCoreTestObject = instance_of(under_handle)
	node_in_tree().add_child(outside)
	owner.add_child(under)
	owner.free()
	assert_false(PoolCore.is_valid(outside_handle))
	assert_false(PoolCore.is_valid(under_handle))
	assert_eq(outside.return_count, 1)
	assert_null(outside.get_parent())
	assert_false(is_instance_valid(under))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
	# No deferred error for the instance destroyed together with its owner object.
	await UnitTestCore.wait_frames(2)


func test_owner_destroy_drops_an_instance_under_a_child_of_the_owner_without_on_return() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var owner: Node2D = node_in_tree()
	var child: Node2D = Node2D.new()
	owner.add_child(child)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var under: PoolCoreTestObject = instance_of(handle)
	child.add_child(under)
	var return_counts: Array[int] = []
	assert_eq(under.tree_exiting.connect(func() -> void: return_counts.append(under.return_count)), OK)
	owner.free()
	assert_eq(return_counts.size(), 1)
	assert_eq(return_counts[0], 0)
	assert_false(is_instance_valid(under))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	await UnitTestCore.wait_frames(2)


func test_owner_destroy_drops_an_instance_under_a_child_added_after_the_borrow_without_on_return() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var owner: Node2D = node_in_tree()
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var under: PoolCoreTestObject = instance_of(handle)
	var child: Node2D = Node2D.new()
	owner.add_child(child)
	child.add_child(under)
	var return_counts: Array[int] = []
	assert_eq(under.tree_exiting.connect(func() -> void: return_counts.append(under.return_count)), OK)
	owner.free()
	assert_eq(return_counts.size(), 1)
	assert_eq(return_counts[0], 0)
	assert_false(is_instance_valid(under))
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	await UnitTestCore.wait_frames(2)


func test_destroying_an_owner_bound_instance_under_its_living_owner_logs_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var owner: Node2D = node_in_tree()
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, owner))
	owner.add_child(instance)
	instance.free()
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(), 1)
	# Outside the owner object as well.
	var outside: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, owner))
	assert_eq(warnings(), 1)
	node_in_tree().add_child(outside)
	outside.free()
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(), 1)


func test_destroying_an_owner_bound_instance_outside_its_owner_then_the_owner_before_the_flush_logs_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	var owner: Node2D = node_in_tree()
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, owner))
	node_in_tree().add_child(instance)
	instance.free()
	owner.free()
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(), 0)


func test_destroying_a_scene_root_that_destroys_an_owner_bound_instance_outside_the_owner_first_logs_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var root: Node2D = node_in_tree()
	var owner: Node2D = Node2D.new()
	root.add_child(owner)
	var under_handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var outside_handle: Vector4i = PoolCore.borrow(EFFECT, scope, owner)
	var under: PoolCoreTestObject = instance_of(under_handle)
	var outside: PoolCoreTestObject = instance_of(outside_handle)
	var under_layer: Node2D = Node2D.new()
	owner.add_child(under_layer)
	under_layer.add_child(under)
	# Added after the owner object: destroyed before it.
	var effect_layer: Node2D = Node2D.new()
	root.add_child(effect_layer)
	effect_layer.add_child(outside)
	root.free()
	assert_false(is_instance_valid(under))
	assert_false(is_instance_valid(outside))
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i.ZERO)
	await UnitTestCore.wait_frames(2)
	assert_eq(errors(), 0)


func test_destroying_an_instance_owner_bound_to_a_constituent_object_then_giving_back_its_parent_logs_an_error() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var parent_handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var socket: Node = instance_of(parent_handle).get_node("Socket")
	var child_instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, socket))
	socket.add_child(child_instance)
	child_instance.free()
	PoolCore.give_back(parent_handle)
	assert_eq(errors(), 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))


func test_instance_borrowed_with_a_constituent_object_as_owner_is_taken_back_with_its_parent_instance() -> void:
	var scope: Scope = await filled_scope(EFFECT, 2)
	var parent_handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	var parent_instance: PoolCoreTestObject = instance_of(parent_handle)
	var socket: Node = parent_instance.get_node("Socket")
	var child_handle: Vector4i = PoolCore.borrow(EFFECT, scope, socket)
	var child_instance: PoolCoreTestObject = instance_of(child_handle)
	socket.add_child(child_instance)
	PoolCore.give_back(parent_handle)
	assert_true(is_instance_valid(child_instance))
	assert_false(PoolCore.is_valid(child_handle))
	assert_eq(child_instance.return_count, 1)
	assert_null(child_instance.get_parent())
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(2, 0))
	await UnitTestCore.wait_frames(1)
	assert_true(is_instance_valid(child_instance))


func test_owner_destroy_after_release_and_init_calls_on_return_once() -> void:
	var first_scope: Scope = await filled_scope(EFFECT, 1)
	PoolCore.borrow(EFFECT, first_scope, node_in_tree())
	PoolCore.release()
	assert_true(PoolCore.init())
	var scope: Scope = await filled_scope(EFFECT, 1)
	var owner: Node2D = node_in_tree()
	var instance: PoolCoreTestObject = instance_of(PoolCore.borrow(EFFECT, scope, owner))
	node_in_tree().add_child(instance)
	owner.free()
	assert_eq(instance.return_count, 1)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(1, 0))
