extends PoolCoreTestCase
## The effect skip of `PoolCoreDev.set_effect_skip`.

var _counter: PoolCoreTestCounter = null
var _physics_handle: Vector4i = Vector4i.ZERO
var _physics_frame: int = -1


func before_each() -> void:
	super()
	_counter = PoolCoreTestCounter.new()
	_nodes.append(_counter)
	assert_true(EventCore.subscribe(EffectSpawnedEvent, _counter.on_effect_spawned))


func test_an_auto_return_borrow_is_lent_without_the_event_and_taken_back_before_the_next_frame() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var frame: int = Engine.get_process_frames()
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	assert_true(PoolCore.is_valid(handle))
	var instance: PoolCoreTestObject = instance_of(handle)
	node_in_tree().add_child(instance)
	assert_eq(instance.borrow_count, 1)
	assert_eq(instance.return_count, 0)
	assert_eq(_counter.count, 0)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(0, 1))
	await UnitTestCore.wait_frames(1)
	assert_false(PoolCore.is_valid(handle))
	assert_eq(instance.return_count, 1)
	# Taken back in the frame of the borrow, before it is drawn.
	assert_eq(instance.return_frame, frame)
	assert_null(instance.get_parent())
	assert_false(node_2d(instance).visible)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))
	assert_eq(_counter.count, 0)
	assert_eq(errors(), 0)


func test_a_borrow_in_the_physics_step_is_taken_back_in_the_same_frame() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	tree.physics_frame.connect(_borrow_in_physics.bind(scope), CONNECT_ONE_SHOT)
	while _physics_frame < 0:
		await tree.process_frame
	await tree.process_frame
	var instance: PoolCoreTestObject = null
	assert_false(PoolCore.is_valid(_physics_handle))
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))
	# The pool holds the one instance; borrowing it again gets the same instance.
	PoolCoreDev.set_effect_skip(false)
	instance = instance_of(PoolCore.borrow(AUTO_EFFECT, scope))
	assert_eq(instance.return_count, 1)
	assert_eq(instance.return_frame, _physics_frame)


func test_give_back_in_the_frame_of_the_borrow_returns_once_without_a_log_from_the_take_back() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(handle)
	PoolCore.give_back(handle)
	assert_eq(instance.return_count, 1)
	await UnitTestCore.wait_frames(1)
	assert_eq(instance.return_count, 1)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))
	assert_eq(errors(), 0)


func test_an_instance_given_back_and_lent_again_in_the_same_frame_is_taken_back_once_for_the_new_borrow() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var first: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	PoolCore.give_back(first)
	var second: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	var instance: PoolCoreTestObject = instance_of(second)
	assert_eq(instance.return_count, 1)
	await UnitTestCore.wait_frames(1)
	assert_false(PoolCore.is_valid(second))
	assert_eq(instance.return_count, 2)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(1, 0))
	assert_eq(errors(), 0)


func test_an_instance_destroyed_before_the_take_back_leaves_only_the_destroy_log() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	instance_of(handle).free()
	# The direct destroy log of the error table.
	assert_eq(errors(), 1)
	await UnitTestCore.wait_frames(1)
	assert_eq(errors(), 0)
	assert_eq(PoolCore.get_pool_state(AUTO_EFFECT, scope), Vector2i(0, 0))


func test_a_manual_return_borrow_is_not_taken_back() -> void:
	var scope: Scope = await filled_scope(EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	var handle: Vector4i = PoolCore.borrow(EFFECT, scope)
	await UnitTestCore.wait_frames(2)
	assert_true(PoolCore.is_valid(handle))
	assert_eq(instance_of(handle).return_count, 0)
	assert_eq(PoolCore.get_pool_state(EFFECT, scope), Vector2i(0, 1))


func test_after_the_skip_is_turned_off_an_auto_return_borrow_publishes_the_event_and_stays() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	PoolCoreDev.set_effect_skip(false)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	assert_eq(_counter.count, 1)
	await UnitTestCore.wait_frames(2)
	assert_true(PoolCore.is_valid(handle))
	assert_eq(instance_of(handle).return_count, 0)


func test_the_skip_is_off_after_release_and_init() -> void:
	PoolCoreDev.set_effect_skip(true)
	PoolCore.release()
	assert_true(PoolCore.init())
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, scope)
	assert_eq(_counter.count, 1)
	await UnitTestCore.wait_frames(2)
	assert_true(PoolCore.is_valid(handle))


func test_a_borrow_before_release_is_not_taken_back_after_init() -> void:
	var scope: Scope = await filled_scope(AUTO_EFFECT, 1)
	PoolCoreDev.set_effect_skip(true)
	PoolCore.borrow(AUTO_EFFECT, scope)
	PoolCore.release()
	assert_true(PoolCore.init())
	var new_scope_value: Scope = await filled_scope(AUTO_EFFECT, 1)
	var handle: Vector4i = PoolCore.borrow(AUTO_EFFECT, new_scope_value)
	await UnitTestCore.wait_frames(2)
	assert_true(PoolCore.is_valid(handle))
	assert_eq(errors(), 0)


func test_set_effect_skip_before_init_logs_an_error() -> void:
	PoolCore.release()
	PoolCoreDev.set_effect_skip(true)
	assert_eq(errors(), 1)
	assert_true(PoolCore.init())


func _borrow_in_physics(scope: Scope) -> void:
	_physics_frame = Engine.get_process_frames()
	_physics_handle = PoolCore.borrow(AUTO_EFFECT, scope)
