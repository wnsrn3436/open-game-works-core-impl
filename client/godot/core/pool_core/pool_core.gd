class_name PoolCore
extends RefCounted
## Object pool: keeps the instances made from a prefab instead of destroying them and lends them out again. There is
## one pool per resource key and pool scope.
##
## A handle is a `Vector4i`: x and y are the low and high 32 bits of the instance ID, z and w those of the generation
## number when the instance was lent. The empty handle is `Vector4i.ZERO`. A value type, so lending makes no object.

const _TAG: String = "PoolCore"
const _DEFAULT_PREFILL_COUNT_KEY: String = "PoolCore.defaultPrefillCount"
const _MAX_POOL_SIZE_KEY: String = "PoolCore.maxPoolSize"
## The generation number maximum: the `int` maximum.
const _MAX_GENERATION: int = 9223372036854775807
const _EMPTY_HANDLE: Vector4i = Vector4i(0, 0, 0, 0)
const _PREFAB_KIND: int = ResourceCore.BaseKind.PACKED_SCENE
## Initial size of the ending owner stack and of the lists of a new pool and a new owner binding.
const _INITIAL_SLOTS: int = 4
const _NODE_SCRIPT := preload("res://core/pool_core/pool_core_node.gd")
const _ENTRY := preload("res://core/pool_core/pool_entry.gd")
const _POOL := preload("res://core/pool_core/pool.gd")
const _SCOPE_POOLS := preload("res://core/pool_core/scope_pools.gd")
const _OWNER_BINDING := preload("res://core/pool_core/owner_binding.gd")
const _PREFAB_WAITER := preload("res://core/pool_core/prefab_waiter.gd")

static var _is_initialized: bool = false
## Replaced by every `init`; an async operation or a deferred call that sees another session does nothing more.
static var _session: RefCounted = null
static var _node: Node = null
static var _default_prefill_count: int = 0
static var _max_pool_size: int = 0
## The scope release listener registered with `ResourceCore`.
static var _listener: Callable = Callable()
## The pools of each pool scope, by the instance ID of the scope.
static var _scope_pools: Dictionary[int, _SCOPE_POOLS] = {}
## The owner-bound borrows of each owner scope, by the instance ID of the scope.
static var _owner_bindings: Dictionary[int, _OWNER_BINDING] = {}
## Return cleaners in registration order.
static var _cleaners: Array[Callable] = []
## Instance IDs of the owner objects whose owner scope common cleanup is ending, as a stack `[0, _ending_count)`.
static var _ending_owner_ids: PackedInt64Array = PackedInt64Array()
static var _ending_count: int = 0
## Borrowed owner-bound instances that may have gone with their owner object: the owner scope instance ID and the
## resource key of each. The owner scope release by the owner object's destruction drops an entry without a log. An
## entry still here at the deferred flush was destroyed outside PoolCore.
static var _pending_scope_ids: PackedInt64Array = PackedInt64Array()
static var _pending_keys: PackedStringArray = PackedStringArray()
static var _flush_scheduled: bool = false
## The prefab loads `prefill` waits for. `release` ends them.
static var _waiters: Array[_PREFAB_WAITER] = []


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_DEFAULT_PREFILL_COUNT_KEY) or not CoreSettings.has_int(_MAX_POOL_SIZE_KEY):
		LogCore.log_error(_TAG, "init: core settings key PoolCore.defaultPrefillCount or PoolCore.maxPoolSize is missing or not an integer")
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	_default_prefill_count = CoreSettings.get_int(_DEFAULT_PREFILL_COUNT_KEY)
	_max_pool_size = CoreSettings.get_int(_MAX_POOL_SIZE_KEY)
	_session = RefCounted.new()
	_ending_owner_ids.resize(_INITIAL_SLOTS)
	_listener = PoolCore._on_scope_released
	ResourceCore.add_scope_release_listener(_listener)
	_node = _NODE_SCRIPT.new()
	_node.name = _TAG
	tree.root.add_child(_node)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_listener)
	var waiters: Array[_PREFAB_WAITER] = _waiters
	_destroy_all(false)
	_reset()
	for waiter: _PREFAB_WAITER in waiters:
		waiter.abort()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Makes each pool of `items` and makes instances until the pool holds the prefill count. Async. True when every item
## succeeded.
static func prefill(items: Array[PrefillItem]) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "prefill: not initialized")
		return false
	var session: RefCounted = _session
	var list: Array[PrefillItem] = []
	list.assign(items)
	var all_filled: bool = true
	for item: PrefillItem in list:
		var filled: bool = await _prefill_item(item, session)
		if session != _session:
			return false
		if not filled:
			all_filled = false
	return all_filled


## Lends an instance of the prefab `resource_key` from the pool of `pool_scope`. With `owner`, an object, the borrow is
## owner-bound to the owner scope of `owner`. The empty handle on failure.
# ogw:input_boundary
static func borrow(resource_key: String, pool_scope: Scope, owner: Variant = null) -> Vector4i:
	if not _is_initialized:
		LogCore.log_error(_TAG, "borrow: not initialized")
		return _EMPTY_HANDLE
	if pool_scope == null or pool_scope.released:
		LogCore.log_error(_TAG, "borrow: the pool scope of %s is released" % resource_key)
		return _EMPTY_HANDLE
	var binding: _OWNER_BINDING = null
	if typeof(owner) != TYPE_NIL:
		binding = _binding_of(owner, resource_key)
		if binding == null:
			return _EMPTY_HANDLE
	var pool: _POOL = _pool_of(resource_key, pool_scope)
	var instance: PoolObject = null
	if pool != null and pool.idle_count > 0:
		instance = _pop_idle(pool)
	else:
		var prefab: PackedScene = null
		if pool != null:
			prefab = pool.prefab
		else:
			prefab = ResourceCore.get_loaded(resource_key, _PREFAB_KIND, pool_scope) as PackedScene
			if prefab == null or not ResourceCore.is_loaded(resource_key, _PREFAB_KIND):
				return _EMPTY_HANDLE
		instance = _instantiate(prefab, resource_key)
		if instance == null:
			return _EMPTY_HANDLE
		if pool == null:
			pool = _make_pool(resource_key, pool_scope, prefab)
		_adopt(pool, instance)
		if CoreBuildInfo.has_dev_code:
			LogCore.log_warn(_TAG, "borrow: the pool of %s has no instance; made a new one" % resource_key)
	return _lend(pool, instance, binding)


## Takes back the instance of `handle`.
static func give_back(handle: Vector4i) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "give_back: not initialized")
		return
	if handle == _EMPTY_HANDLE:
		return
	var instance: PoolObject = _instance_of(handle)
	if instance == null:
		LogCore.log_error(_TAG, "give_back: the handle is not valid")
		return
	_take_back(instance, "give_back")


## Called by an auto-return pool object when it ends. PoolCore takes it back.
static func notify_finished(instance: Node) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "notify_finished: not initialized")
		return
	var pool_object: PoolObject = instance as PoolObject
	if pool_object == null or pool_object._pool_entry == null:
		LogCore.log_error(_TAG, "notify_finished: the instance was not made by PoolCore")
		return
	if not pool_object._pool_entry.auto_return:
		LogCore.log_error(_TAG, "notify_finished: the instance is a manual-return instance")
		return
	_take_back(pool_object, "notify_finished")


static func is_valid(handle: Vector4i) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_valid: not initialized")
		return false
	return _instance_of(handle) != null


## The instance of a valid handle, or null.
static func get_instance(handle: Vector4i) -> Node:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_instance: not initialized")
		return null
	if handle == _EMPTY_HANDLE:
		return null
	var instance: PoolObject = _instance_of(handle)
	if instance == null:
		LogCore.log_error(_TAG, "get_instance: the handle is not valid")
	return instance


## x: the instances in the pool of `resource_key` and `pool_scope`, y: its borrowed instances. Zero for no pool.
static func get_pool_state(resource_key: String, pool_scope: Scope) -> Vector2i:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_pool_state: not initialized")
		return Vector2i.ZERO
	var pool: _POOL = _pool_of(resource_key, pool_scope)
	if pool == null:
		return Vector2i.ZERO
	return Vector2i(pool.idle_count, pool.borrowed_count)


## Adds `cleaner`, a function that takes one constituent object, cleans it up and returns how many items it left.
static func add_return_cleaner(cleaner: Callable) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "add_return_cleaner: not initialized")
		return
	if _cleaners.has(cleaner):
		return
	_cleaners.append(cleaner)


static func _prefill_item(item: PrefillItem, session: RefCounted) -> bool:
	if item == null:
		LogCore.log_error(_TAG, "prefill: an item is null")
		return false
	var scope: Scope = item.pool_scope
	if scope == null or scope.released:
		LogCore.log_error(_TAG, "prefill: the pool scope of %s is released" % item.resource_key)
		return false
	var count: int = item.count
	if count < 0:
		count = _default_prefill_count
	if count > _max_pool_size:
		LogCore.log_warn(_TAG, "prefill: the prefill count %d of %s is over PoolCore.maxPoolSize" % [count, item.resource_key])
		count = _max_pool_size
	var waiter: _PREFAB_WAITER = _PREFAB_WAITER.new()
	_waiters.append(waiter)
	waiter.start(item.resource_key, _PREFAB_KIND, scope)
	if not waiter.finished:
		await waiter.done
	if session != _session or waiter.aborted:
		return false
	_waiters.erase(waiter)
	if scope.released:
		return false
	var prefab: PackedScene = waiter.resource as PackedScene
	if prefab == null or not ResourceCore.is_loaded(item.resource_key, _PREFAB_KIND):
		return false
	var pool: _POOL = _pool_of(item.resource_key, scope)
	if pool == null and count > 0:
		var first: PoolObject = _instantiate(prefab, item.resource_key)
		if first == null:
			return false
		pool = _make_pool(item.resource_key, scope, prefab)
		_adopt(pool, first)
		_push_idle(pool, first)
	elif pool == null:
		# No instance stays, but the prefab is checked like every new pool's.
		var check: PoolObject = _instantiate(prefab, item.resource_key)
		if check == null:
			return false
		check.free()
		pool = _make_pool(item.resource_key, scope, prefab)
	pool.prefill_count = count
	while pool.idle_count < count:
		var instance: PoolObject = _instantiate(pool.prefab, item.resource_key)
		if instance == null:
			return false
		_adopt(pool, instance)
		_push_idle(pool, instance)
	return true


## The owner binding of the owner scope of `owner`, made on first use. Null with an error log when `owner` is destroyed
## or its owner scope is released.
# ogw:input_boundary
static func _binding_of(owner: Variant, resource_key: String) -> _OWNER_BINDING:
	if typeof(owner) != TYPE_OBJECT or not is_instance_valid(owner):
		LogCore.log_error(_TAG, "borrow: the owner object of %s is destroyed" % resource_key)
		return null
	var object: Object = owner
	var owner_node: Node = object as Node
	if owner_node == null:
		LogCore.log_error(_TAG, "borrow: the owner object of %s is not a Node" % resource_key)
		return null
	var owner_scope: Scope = ResourceCore.get_owner_scope(owner_node)
	if owner_scope == null or owner_scope.released:
		LogCore.log_error(_TAG, "borrow: the owner scope of %s is released" % resource_key)
		return null
	var scope_id: int = owner_scope.get_instance_id()
	if _owner_bindings.has(scope_id):
		return _owner_bindings[scope_id]
	var binding: _OWNER_BINDING = _OWNER_BINDING.new()
	binding.owner_scope = owner_scope
	binding.owner_id = owner_node.get_instance_id()
	binding.items.resize(_INITIAL_SLOTS)
	_owner_bindings[scope_id] = binding
	return binding


static func _pool_of(resource_key: String, pool_scope: Scope) -> _POOL:
	if pool_scope == null:
		return null
	var scope_id: int = pool_scope.get_instance_id()
	if not _scope_pools.has(scope_id):
		return null
	var scope_pools: _SCOPE_POOLS = _scope_pools[scope_id]
	if not scope_pools.pools.has(resource_key):
		return null
	return scope_pools.pools[resource_key]


static func _make_pool(resource_key: String, pool_scope: Scope, prefab: PackedScene) -> _POOL:
	var pool: _POOL = _POOL.new()
	pool.resource_key = resource_key
	pool.pool_scope = pool_scope
	pool.prefab = prefab
	pool.idle.resize(_INITIAL_SLOTS)
	pool.borrowed.resize(_INITIAL_SLOTS)
	var scope_id: int = pool_scope.get_instance_id()
	var scope_pools: _SCOPE_POOLS = null
	if _scope_pools.has(scope_id):
		scope_pools = _scope_pools[scope_id]
	else:
		scope_pools = _SCOPE_POOLS.new()
		_scope_pools[scope_id] = scope_pools
	scope_pools.pools[resource_key] = pool
	scope_pools.list.append(pool)
	return pool


## A new instance of `prefab`, or null with an error log when its root script does not override `on_borrow` and
## `on_return` of `PoolObject`.
static func _instantiate(prefab: PackedScene, resource_key: String) -> PoolObject:
	var node: Node = prefab.instantiate()
	if node == null:
		LogCore.log_error(_TAG, "the prefab %s did not make an instance" % resource_key)
		return null
	var instance: PoolObject = node as PoolObject
	if instance == null or not _implements_callbacks(instance):
		LogCore.log_error(_TAG, "the prefab %s does not implement on_borrow and on_return of PoolObject" % resource_key)
		node.free()
		return null
	return instance


## Whether the root script of `instance` overrides both `on_borrow` and `on_return`. The script method list holds the
## methods of every script of the inheritance chain, so an overridden method is in it more than once.
# ogw:input_boundary
static func _implements_callbacks(instance: PoolObject) -> bool:
	var script_value: Variant = instance.get_script()
	if not script_value is Script:
		return false
	var script: Script = script_value
	var borrow_count: int = 0
	var return_count: int = 0
	for method: Dictionary in script.get_script_method_list():
		var method_name: Variant = method.get("name")
		if not (method_name is String or method_name is StringName):
			continue
		var text: String = str(method_name)
		if text == "on_borrow":
			borrow_count += 1
		elif text == "on_return":
			return_count += 1
	return borrow_count > 1 and return_count > 1


## Makes `instance` a pool object of `pool`: records its constituent objects, auto-return, visibility and position.
static func _adopt(pool: _POOL, instance: PoolObject) -> void:
	var entry: _ENTRY = _ENTRY.new()
	entry.pool = pool
	entry.auto_return = instance.auto_return
	_collect_parts(instance, entry.parts)
	var node: Node = instance
	var canvas_item: CanvasItem = node as CanvasItem
	var node_3d: Node3D = node as Node3D
	var canvas_layer: CanvasLayer = node as CanvasLayer
	var node_2d: Node2D = node as Node2D
	var control: Control = node as Control
	if canvas_item != null:
		entry.visible = canvas_item.visible
	elif node_3d != null:
		entry.visible = node_3d.visible
	elif canvas_layer != null:
		entry.visible = canvas_layer.visible
	if node_2d != null:
		entry.position_2d = node_2d.position
	elif control != null:
		entry.position_2d = control.position
	elif node_3d != null:
		entry.position_3d = node_3d.position
	instance._pool_entry = entry


static func _collect_parts(node: Node, parts: Array[Node]) -> void:
	parts.append(node)
	for child: Node in node.get_children(true):
		_collect_parts(child, parts)


static func _lend(pool: _POOL, instance: PoolObject, binding: _OWNER_BINDING) -> Vector4i:
	var entry: _ENTRY = instance._pool_entry
	entry.state = _ENTRY.State.BORROWED
	if pool.borrowed_count == pool.borrowed.size():
		pool.borrowed.resize(pool.borrowed_count * 2)
	entry.index = pool.borrowed_count
	pool.borrowed[pool.borrowed_count] = instance
	pool.borrowed_count += 1
	if binding != null:
		if binding.count == binding.items.size():
			binding.items.resize(binding.count * 2)
		entry.owner = binding
		entry.owner_index = binding.count
		entry.exit = _ENTRY.Exit.NONE
		binding.items[binding.count] = instance
		binding.count += 1
	_set_visible(instance, entry.visible)
	var handle: Vector4i = _make_handle(instance.get_instance_id(), entry.generation)
	instance.on_borrow()
	if entry.auto_return:
		EventCore.publish(EventCore.acquire(EffectSpawnedEvent))
	return handle


## Takes back a borrowed or returning `instance` with the return order of the spec.
static func _take_back(instance: PoolObject, operation: String) -> void:
	var entry: _ENTRY = instance._pool_entry
	var pool: _POOL = entry.pool as _POOL
	if entry.state != _ENTRY.State.BORROWED:
		LogCore.log_error(_TAG, "%s: double return of an instance of %s" % [operation, pool.resource_key])
		return
	entry.state = _ENTRY.State.RETURNING
	_remove_borrowed(pool, entry)
	_unbind_owner(entry)
	var at_max_generation: bool = entry.generation == _MAX_GENERATION
	if not at_max_generation:
		entry.generation += 1
	var session: RefCounted = _session
	instance.on_return()
	if session != _session or not _still_returning(instance, entry):
		return
	_clean_up(instance, entry)
	if session != _session or not _still_returning(instance, entry):
		return
	if pool.removed or at_max_generation or pool.idle_count >= _max_pool_size:
		_destroy(instance)
		return
	_push_idle(pool, instance)


static func _still_returning(instance: PoolObject, entry: _ENTRY) -> bool:
	return is_instance_valid(instance) and instance._pool_entry == entry and entry.state == _ENTRY.State.RETURNING


## Common cleanup: end the owner scopes, return cleaners, unsubscribe, hide, detach, put the position back.
static func _clean_up(instance: PoolObject, entry: _ENTRY) -> void:
	var parts: Array[Node] = entry.parts
	for i: int in parts.size():
		if is_instance_valid(parts[i]):
			_end_owner_scope(parts[i])
	var items_left: bool = false
	for i: int in parts.size():
		for cleaner: Callable in _cleaners:
			if is_instance_valid(parts[i]) and _call_cleaner(cleaner, parts[i]) > 0:
				items_left = true
	for i: int in parts.size():
		if is_instance_valid(parts[i]):
			EventCore.unsubscribe_all(parts[i])
	_set_visible(instance, false)
	var parent: Node = instance.get_parent()
	if parent != null:
		parent.remove_child(instance)
	var node: Node = instance
	var node_2d: Node2D = node as Node2D
	var control: Control = node as Control
	var node_3d: Node3D = node as Node3D
	if node_2d != null:
		node_2d.position = entry.position_2d
	elif control != null:
		control.position = entry.position_2d
	elif node_3d != null:
		node_3d.position = entry.position_3d
	if not CoreBuildInfo.has_dev_code:
		return
	var subscribed: bool = false
	for i: int in parts.size():
		if is_instance_valid(parts[i]) and EventCore.count_subscriptions(parts[i]) > 0:
			subscribed = true
	if subscribed or items_left:
		LogCore.log_error(_TAG, "leak check: a constituent object of an instance of %s keeps a subscription or items after common cleanup" % (entry.pool as _POOL).resource_key)


static func _end_owner_scope(part: Node) -> void:
	if _ending_count == _ending_owner_ids.size():
		_ending_owner_ids.resize(_ending_count * 2)
	_ending_owner_ids[_ending_count] = part.get_instance_id()
	_ending_count += 1
	var session: RefCounted = _session
	ResourceCore.end_owner_scope(part)
	if session == _session:
		_ending_count -= 1


## The remaining item count `cleaner` returns for `part`. 0 when it does not return an integer.
# ogw:input_boundary
static func _call_cleaner(cleaner: Callable, part: Node) -> int:
	var remaining: Variant = cleaner.call(part)
	if remaining is int:
		return remaining
	LogCore.log_error(_TAG, "a return cleaner did not return an integer")
	return 0


static func _set_visible(instance: Node, value: bool) -> void:
	var canvas_item: CanvasItem = instance as CanvasItem
	if canvas_item != null:
		canvas_item.visible = value
		return
	var node_3d: Node3D = instance as Node3D
	if node_3d != null:
		node_3d.visible = value
		return
	var canvas_layer: CanvasLayer = instance as CanvasLayer
	if canvas_layer != null:
		canvas_layer.visible = value


static func _push_idle(pool: _POOL, instance: PoolObject) -> void:
	var entry: _ENTRY = instance._pool_entry
	entry.state = _ENTRY.State.IDLE
	if pool.idle_count == pool.idle.size():
		pool.idle.resize(pool.idle_count * 2)
	entry.index = pool.idle_count
	pool.idle[pool.idle_count] = instance
	pool.idle_count += 1


static func _pop_idle(pool: _POOL) -> PoolObject:
	pool.idle_count -= 1
	var instance: PoolObject = pool.idle[pool.idle_count]
	pool.idle[pool.idle_count] = null
	(instance._pool_entry as _ENTRY).index = -1
	return instance


static func _remove_idle(pool: _POOL, entry: _ENTRY) -> void:
	_remove_at(pool.idle, pool.idle_count, entry.index)
	pool.idle_count -= 1
	entry.index = -1


static func _remove_borrowed(pool: _POOL, entry: _ENTRY) -> void:
	_remove_at(pool.borrowed, pool.borrowed_count, entry.index)
	pool.borrowed_count -= 1
	entry.index = -1


## Moves the last used item of `list` to `index` and clears the last slot.
static func _remove_at(list: Array[PoolObject], count: int, index: int) -> void:
	var last: int = count - 1
	if index != last:
		var moved: PoolObject = list[last]
		list[index] = moved
		(moved._pool_entry as _ENTRY).index = index
	list[last] = null


static func _unbind_owner(entry: _ENTRY) -> void:
	var binding: _OWNER_BINDING = entry.owner as _OWNER_BINDING
	if binding == null:
		return
	var last: int = binding.count - 1
	if entry.owner_index != last:
		var moved: PoolObject = binding.items[last]
		binding.items[entry.owner_index] = moved
		(moved._pool_entry as _ENTRY).owner_index = entry.owner_index
	binding.items[last] = null
	binding.count -= 1
	entry.owner = null
	entry.owner_index = -1


## Stops keeping `instance` and destroys it.
static func _destroy(instance: PoolObject) -> void:
	instance._pool_entry = null
	instance.queue_free()


static func _make_handle(instance_id: int, generation: int) -> Vector4i:
	return Vector4i(_low_half(instance_id), instance_id >> 32, _low_half(generation), generation >> 32)


## The low 32 bits of `value` as a signed 32-bit integer.
static func _low_half(value: int) -> int:
	var low: int = value & 0xFFFFFFFF
	if low >= 0x80000000:
		low -= 0x100000000
	return low


## The pool object of a valid handle: not destroyed, kept by PoolCore and of the same generation number. Null otherwise.
static func _instance_of(handle: Vector4i) -> PoolObject:
	var instance_id: int = (handle.y << 32) | (handle.x & 0xFFFFFFFF)
	if instance_id == 0:
		return null
	var instance: PoolObject = instance_from_id(instance_id) as PoolObject
	if instance == null or instance._pool_entry == null:
		return null
	var generation: int = (handle.w << 32) | (handle.z & 0xFFFFFFFF)
	if instance._pool_entry.generation != generation:
		return null
	return instance


## Scope release listener: handles the owner-bound borrows of a released owner scope and the pools of a released pool
## scope.
static func _on_scope_released(scope: Scope) -> void:
	if not _is_initialized or scope == null:
		return
	var scope_id: int = scope.get_instance_id()
	var session: RefCounted = _session
	if _owner_bindings.has(scope_id):
		_release_owner_scope(scope_id)
		if session != _session:
			return
	if _scope_pools.has(scope_id):
		_release_pool_scope(scope_id)


static func _release_owner_scope(scope_id: int) -> void:
	var binding: _OWNER_BINDING = _owner_bindings[scope_id]
	_owner_bindings.erase(scope_id)
	var ending: bool = false
	for i: int in _ending_count:
		if _ending_owner_ids[i] == binding.owner_id:
			ending = true
	# Common cleanup ends the owner scope of a living owner object: a destroyed instance did not go with it.
	_drop_pending(scope_id, ending)
	var owner_node: Node = instance_from_id(binding.owner_id) as Node
	var session: RefCounted = _session
	while binding.count > 0:
		var instance: PoolObject = binding.items[binding.count - 1]
		var entry: _ENTRY = instance._pool_entry
		_unbind_owner(entry)
		if not ending and owner_node != null and owner_node.is_ancestor_of(instance):
			# Destroyed together with the owner object: out of the pool without on_return and common cleanup.
			_remove_borrowed(entry.pool as _POOL, entry)
			instance._pool_entry = null
			continue
		_take_back(instance, "owner scope release")
		if session != _session:
			return


static func _release_pool_scope(scope_id: int) -> void:
	var scope_pools: _SCOPE_POOLS = _scope_pools[scope_id]
	var session: RefCounted = _session
	for pool: _POOL in scope_pools.list:
		if pool.borrowed_count > 0:
			LogCore.log_error(_TAG, "the pool scope of %s was released with %d borrowed instances" % [pool.resource_key, pool.borrowed_count])
		while pool.borrowed_count > 0:
			_take_back(pool.borrowed[pool.borrowed_count - 1], "pool scope release")
			if session != _session:
				return
		while pool.idle_count > 0:
			_destroy(_pop_idle(pool))
		pool.removed = true
	_scope_pools.erase(scope_id)


## Called by a pool object kept by PoolCore when it is destroyed.
static func _on_pool_object_predelete(instance: PoolObject) -> void:
	var entry: _ENTRY = instance._pool_entry
	instance._pool_entry = null
	if not _is_initialized or entry == null:
		return
	var pool: _POOL = entry.pool as _POOL
	if entry.state == _ENTRY.State.IDLE:
		_remove_idle(pool, entry)
		LogCore.log_error(_TAG, "an instance of %s in the pool was destroyed outside PoolCore" % pool.resource_key)
	elif entry.state == _ENTRY.State.BORROWED:
		_remove_borrowed(pool, entry)
		var binding: _OWNER_BINDING = entry.owner as _OWNER_BINDING
		_unbind_owner(entry)
		if binding != null and _may_go_with_owner(instance, entry, binding):
			# Destroyed together with its owner object when the owner scope release follows before the deferred
			# flush.
			_add_pending(binding.owner_scope.get_instance_id(), pool.resource_key)
		else:
			LogCore.log_error(_TAG, "a borrowed instance of %s was destroyed outside PoolCore" % pool.resource_key)
	else:
		LogCore.log_error(_TAG, "an instance of %s was destroyed outside PoolCore while it was given back" % pool.resource_key)


## Whether the borrowed `instance`, owner-bound with `binding` and being destroyed, can be going with its owner object.
## A destroyed node leaves the scene tree before its children are destroyed, and each node leaves its parent before
## its own children are destroyed, so a node under a destroyed node keeps its parent but not the rest of its ancestry.
static func _may_go_with_owner(instance: PoolObject, entry: _ENTRY, binding: _OWNER_BINDING) -> bool:
	# Still in the scene tree: `instance` itself is the destroyed node.
	if instance.is_inside_tree():
		return false
	var owner_node: Node = instance_from_id(binding.owner_id) as Node
	# An owner object in the scene tree is not being destroyed.
	if owner_node == null or owner_node.is_inside_tree():
		return false
	if owner_node.is_ancestor_of(instance):
		return true
	# Left the scene tree outside the owner object, for example with a scene root destroyed before the owner object.
	return entry.exit != _ENTRY.Exit.OUTSIDE_OWNER


## Called by a borrowed pool object kept by PoolCore when it leaves the scene tree: records whether an owner-bound
## instance was under its owner object, whose ancestry is still whole here.
static func _on_pool_object_exit_tree(instance: PoolObject) -> void:
	var entry: _ENTRY = instance._pool_entry
	if not _is_initialized or entry.state != _ENTRY.State.BORROWED:
		return
	var binding: _OWNER_BINDING = entry.owner as _OWNER_BINDING
	if binding == null:
		return
	var owner_node: Node = instance_from_id(binding.owner_id) as Node
	if owner_node != null and owner_node.is_ancestor_of(instance):
		entry.exit = _ENTRY.Exit.UNDER_OWNER
	else:
		entry.exit = _ENTRY.Exit.OUTSIDE_OWNER


static func _add_pending(scope_id: int, resource_key: String) -> void:
	_pending_scope_ids.append(scope_id)
	_pending_keys.append(resource_key)
	if not _flush_scheduled:
		_flush_scheduled = true
		PoolCore._flush_pending.bind(_session).call_deferred()


static func _drop_pending(scope_id: int, destroyed_outside: bool) -> void:
	var i: int = _pending_scope_ids.size() - 1
	while i >= 0:
		if _pending_scope_ids[i] == scope_id:
			if destroyed_outside:
				LogCore.log_error(_TAG, "a borrowed instance of %s was destroyed outside PoolCore" % _pending_keys[i])
			_pending_scope_ids.remove_at(i)
			_pending_keys.remove_at(i)
		i -= 1


## Deferred: an owner-bound instance destroyed while its owner scope stayed was destroyed outside PoolCore.
static func _flush_pending(session: RefCounted) -> void:
	if session != _session:
		return
	_flush_scheduled = false
	for resource_key: String in _pending_keys:
		LogCore.log_error(_TAG, "a borrowed instance of %s was destroyed outside PoolCore" % resource_key)
	_pending_scope_ids = PackedInt64Array()
	_pending_keys = PackedStringArray()


## Memory warning: destroys the instances in each pool over its prefill count.
static func _on_memory_warning() -> void:
	if not _is_initialized:
		return
	for scope_pools: _SCOPE_POOLS in _scope_pools.values():
		for pool: _POOL in scope_pools.list:
			while pool.idle_count > pool.prefill_count:
				_destroy(_pop_idle(pool))


## Destroys every pool object, borrowed ones included, without logs. In a tree teardown only the objects without a
## parent are freed here; the others go with their parent.
static func _destroy_all(teardown: bool) -> void:
	for scope_pools: _SCOPE_POOLS in _scope_pools.values():
		for pool: _POOL in scope_pools.list:
			for i: int in pool.idle_count:
				_destroy_on_release(pool.idle[i], teardown)
			for i: int in pool.borrowed_count:
				_destroy_on_release(pool.borrowed[i], teardown)
			pool.idle_count = 0
			pool.borrowed_count = 0
			pool.removed = true


static func _destroy_on_release(instance: PoolObject, teardown: bool) -> void:
	if not is_instance_valid(instance):
		return
	instance._pool_entry = null
	if not teardown:
		instance.queue_free()
	elif instance.get_parent() == null:
		instance.free()


static func _reset() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_default_prefill_count = 0
	_max_pool_size = 0
	_listener = Callable()
	_scope_pools = {}
	_owner_bindings = {}
	_cleaners = []
	_ending_owner_ids = PackedInt64Array()
	_ending_count = 0
	_pending_scope_ids = PackedInt64Array()
	_pending_keys = PackedStringArray()
	_flush_scheduled = false
	_waiters = []


## Called by the core node when it leaves the tree. Outside `release` this is a tree teardown: clear like `release`
## without detaching the node.
static func _on_node_exit_tree(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	if ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_listener)
	var waiters: Array[_PREFAB_WAITER] = _waiters
	_destroy_all(true)
	_reset()
	for waiter: _PREFAB_WAITER in waiters:
		waiter.abort()
