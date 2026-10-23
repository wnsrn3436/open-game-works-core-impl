extends PoolCoreTestCase
## `borrow`, `is_valid`, `get_instance`, `get_pool_state` and `give_back` do not allocate memory.

const WARM_UP: int = 100
const MEASURED: int = 1000

var _scope: Scope = null


func test_lending_and_taking_back_from_a_pool_with_instances_does_not_allocate() -> void:
	_scope = await filled_scope(QUIET, 1)
	LogCore.release()
	_cycle(WARM_UP)
	var objects: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	_cycle(MEASURED)
	# Read both before any assert: recording an assert allocates memory.
	var objects_after: float = Performance.get_monitor(Performance.OBJECT_COUNT)
	var memory_after: float = Performance.get_monitor(Performance.MEMORY_STATIC)
	assert_true(objects_after <= objects, "object count")
	assert_true(memory_after <= memory, "static memory")
	assert_eq(PoolCore.get_pool_state(QUIET, _scope), Vector2i(1, 0))


func _cycle(count: int) -> void:
	for i: int in count:
		var handle: Vector4i = PoolCore.borrow(QUIET, _scope)
		if PoolCore.is_valid(handle) and PoolCore.get_instance(handle) != null:
			PoolCore.get_pool_state(QUIET, _scope)
		PoolCore.give_back(handle)
