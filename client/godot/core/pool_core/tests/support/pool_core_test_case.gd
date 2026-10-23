class_name PoolCoreTestCase
extends UnitTestCase
## Base of the PoolCore core tests: the test prefabs, the modules PoolCore depends on started in module list order
## before each test with `PoolCore.defaultPrefillCount` 2 and `PoolCore.maxPoolSize` 3, and the nodes a test makes
## freed after it. A pool scope is the owner scope of a holder node, released by freeing the holder.

const TAG: String = "PoolCore"
const RESOURCES: String = "res://core/pool_core/tests/resources/"
const EFFECT: String = "prefab/pool_test_effect"
const AUTO_EFFECT: String = "prefab/pool_test_auto_effect"
const QUIET: String = "prefab/pool_test_quiet"
const NO_CALLBACKS: String = "prefab/pool_test_no_callbacks"
const NOT_POOL_OBJECT: String = "prefab/pool_test_not_pool_object"
## Not in the test key list.
const UNKNOWN: String = "prefab/pool_test_unknown"
## Not in the test key list either.
const OTHER_UNKNOWN: String = "prefab/pool_test_other_unknown"
const DEFAULT_PREFILL_COUNT: int = 2
const MAX_POOL_SIZE: int = 3
const KIND: int = ResourceCore.BaseKind.PACKED_SCENE

var _nodes: Array[Node] = []
## The holder node of each scope `new_scope` made, by the instance ID of the scope.
var _holders: Dictionary[int, Node] = {}
## Constituent objects a counting cleaner received, by instance ID.
var cleaned: Dictionary[int, int] = {}
## What the counting cleaner returns.
var cleaner_result: int = 0


func before_each() -> void:
	super()
	cleaned.clear()
	cleaner_result = 0
	assert_true(UnitTestCore.set_test_settings("PoolCore.defaultPrefillCount", DEFAULT_PREFILL_COUNT))
	assert_true(UnitTestCore.set_test_settings("PoolCore.maxPoolSize", MAX_POOL_SIZE))
	var keys: Dictionary[String, String] = {
		EFFECT: RESOURCES + "test_effect.tscn",
		AUTO_EFFECT: RESOURCES + "test_auto_effect.tscn",
		QUIET: RESOURCES + "test_quiet.tscn",
		NO_CALLBACKS: RESOURCES + "test_no_callbacks.tscn",
		NOT_POOL_OBJECT: RESOURCES + "test_not_pool_object.tscn",
	}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init()
	)
	assert_true(started, "PoolCore and its dependencies init")


func after_each() -> void:
	super()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()
	_holders.clear()


## A node in the tree freed after the test.
func node_in_tree() -> Node2D:
	var node: Node2D = Node2D.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_nodes.append(node)
	return node


## A pool scope: the owner scope of a new holder node. Free the holder to release it.
func new_scope() -> Scope:
	var holder: Node2D = node_in_tree()
	var scope: Scope = ResourceCore.get_owner_scope(holder)
	_holders[scope.get_instance_id()] = holder
	return scope


## Releases a pool scope made by `new_scope` by freeing its holder node.
func release_scope(scope: Scope) -> void:
	_holders[scope.get_instance_id()].free()
	assert_true(scope.released)


## Loads `key` into `scope` so the prefab is in the cache. Async.
func load_prefab(key: String, scope: Scope) -> void:
	var resource: Resource = await ResourceCore.load(key, KIND, scope)
	assert_true(resource is PackedScene and ResourceCore.is_loaded(key, KIND), key)


## A pool of `key` in a new scope holding `count` instances. Async.
func filled_scope(key: String, count: int) -> Scope:
	var scope: Scope = new_scope()
	assert_true(await PoolCore.prefill([item(key, scope, count)]))
	assert_eq(PoolCore.get_pool_state(key, scope), Vector2i(count, 0))
	return scope


func item(key: String, scope: Scope, count: int = -1) -> PrefillItem:
	var prefill_item: PrefillItem = PrefillItem.new()
	prefill_item.resource_key = key
	prefill_item.pool_scope = scope
	prefill_item.count = count
	return prefill_item


## Starts `PoolCore.prefill(items)` without waiting.
func start_prefill(items: Array[PrefillItem]) -> PoolCoreTestPrefillRun:
	var prefill_run: PoolCoreTestPrefillRun = PoolCoreTestPrefillRun.new()
	prefill_run.run(items)
	return prefill_run


func instance_of(handle: Vector4i) -> PoolCoreTestObject:
	return PoolCore.get_instance(handle) as PoolCoreTestObject


## The instance as a `Node2D`: the test prefab roots are `Node2D`.
func node_2d(instance: Node) -> Node2D:
	return instance as Node2D


## A return cleaner that counts the constituent objects it receives and returns `cleaner_result`.
func counting_cleaner(part: Node) -> int:
	var id: int = part.get_instance_id()
	if cleaned.has(id):
		cleaned[id] += 1
	else:
		cleaned[id] = 1
	return cleaner_result


func errors(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("error", tag)


func warnings(tag: String = TAG) -> int:
	return UnitTestCore.check_logs("warn", tag)
