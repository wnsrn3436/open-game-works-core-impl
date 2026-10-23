class_name EventCore
extends RefCounted
## Delivers core events and content events to the subscribers of their event type, synchronously.

const _TAG: String = "EventCore"
const _NODE_SCRIPT := preload("res://core/event_core/event_core_node.gd")
const _TYPE_STATE := preload("res://core/event_core/event_type_state.gd")
## Bits of a slot reference that hold the slot. The bits above hold the index of the type state.
const _SLOT_MASK: int = 0xFFFFFFFF

static var _is_initialized: bool = false
## Core node in the tree while initialized.
static var _node: Node = null
## Session of the current `init`. A delivery stops when `release` replaces it.
static var _session: RefCounted = null
## State of each event type seen since `init`.
static var _types: Dictionary[Script, _TYPE_STATE] = {}
## The values of `_types`, by the index a slot reference holds.
static var _type_list: Array[_TYPE_STATE] = []
## Slot reference of the first subscription of each subscriber, by subscriber instance ID. -1 marks a subscriber with
## no subscription left: clearing a slot does not erase the key, so it does not resize the dictionary.
static var _heads: Dictionary[int, int] = {}
## Keys of `_heads` whose subscriber has a subscription.
static var _subscriber_count: int = 0
## Serial the next subscription gets.
static var _next_serial: int = 0
## Listeners `EventCoreDev.register_init_listener` registered, called in order right before `init` ends. `release`
## clears them.
static var _init_listeners: Array[Callable] = []


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	_session = RefCounted.new()
	_node = _NODE_SCRIPT.new()
	_node.name = _TAG
	tree.root.add_child(_node)
	_is_initialized = true
	var session: RefCounted = _session
	var listeners: Array[Callable] = _init_listeners.duplicate()
	for listener: Callable in listeners:
		if listener.is_valid():
			listener.call()
		if _session != session:
			break
	return _is_initialized


static func release() -> void:
	_init_listeners = []
	if not _is_initialized:
		return
	var node: Node = _node
	_reset()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Subscribes `callback`, a method of its subscriber object that takes one event of `type`.
static func subscribe(type: Script, callback: Callable) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "subscribe: not initialized")
		return false
	if not _is_event_type(type):
		LogCore.log_error(_TAG, "subscribe: the type is not an event type: its base script is not EventBase")
		return false
	if callback.is_custom():
		LogCore.log_error(_TAG, "subscribe: the callback is a lambda or a bound callable")
		return false
	if callback.get_object() is Script:
		LogCore.log_error(_TAG, "subscribe: the callback is a static function")
		return false
	var subscriber_id: int = callback.get_object_id()
	if not is_instance_id_valid(subscriber_id):
		LogCore.log_error(_TAG, "subscribe: the subscriber of the callback is destroyed")
		return false
	var state: _TYPE_STATE = _state_of(type)
	var empty_slot: int = -1
	for i: int in state.callbacks.size():
		if state.subscriber_ids[i] == 0:
			if empty_slot < 0:
				empty_slot = i
		elif state.callbacks[i] == callback:
			LogCore.log_error(_TAG, "subscribe: the callback already subscribes to %s" % state.type_name)
			return false
	if empty_slot < 0:
		empty_slot = state.callbacks.size()
		state.callbacks.append(callback)
		state.subscriber_ids.append(subscriber_id)
		state.serials.append(_next_serial)
		state.next_refs.append(-1)
		state.prev_refs.append(-1)
	else:
		state.callbacks[empty_slot] = callback
		state.subscriber_ids[empty_slot] = subscriber_id
		state.serials[empty_slot] = _next_serial
	_link_slot(state, empty_slot, subscriber_id)
	_next_serial += 1
	return true


static func unsubscribe(type: Script, callback: Callable) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "unsubscribe: not initialized")
		return
	if not _is_event_type(type):
		LogCore.log_error(_TAG, "unsubscribe: the type is not an event type: its base script is not EventBase")
		return
	if not _types.has(type):
		return
	var state: _TYPE_STATE = _types[type]
	for i: int in state.callbacks.size():
		if state.subscriber_ids[i] != 0 and state.callbacks[i] == callback:
			_clear_slot(state, i)
			return


## Removes every subscription of `subscriber` and returns how many it removed.
static func unsubscribe_all(subscriber: Object) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "unsubscribe_all: not initialized")
		return 0
	if subscriber == null:
		return 0
	var removed: int = 0
	var ref: int = _heads.get(subscriber.get_instance_id(), -1)
	while ref >= 0:
		var state: _TYPE_STATE = _type_list[ref >> 32]
		var slot: int = ref & _SLOT_MASK
		ref = state.next_refs[slot]
		_clear_slot(state, slot)
		removed += 1
	return removed


static func count_subscriptions(subscriber: Object) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "count_subscriptions: not initialized")
		return 0
	if subscriber == null:
		return 0
	return _count_subscriptions_of(subscriber.get_instance_id())


## The event object of the current delivery depth of `type`, for the publisher to fill and pass to `publish`.
static func acquire(type: Script) -> EventBase:
	if not _is_initialized:
		LogCore.log_error(_TAG, "acquire: not initialized")
		return null
	if not _is_event_type(type):
		LogCore.log_error(_TAG, "acquire: the type is not an event type: its base script is not EventBase")
		return null
	var state: _TYPE_STATE = _state_of(type)
	if state.depth < state.events.size():
		return state.events[state.depth]
	var event: EventBase = (type as GDScript).new()
	state.events.append(event)
	return event


static func publish(event: EventBase) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "publish: not initialized")
		return
	var state: _TYPE_STATE = null
	if event != null:
		var type: Script = event.get_script()
		if _types.has(type):
			state = _types[type]
	if state == null or state.depth >= state.events.size() or state.events[state.depth] != event:
		LogCore.log_error(_TAG, "publish: the event is not the object acquire returned for this delivery depth")
		return
	_remove_destroyed(state)
	var session: RefCounted = _session
	var serial_end: int = _next_serial
	var slot_count: int = state.callbacks.size()
	var called: int = 0
	state.depth += 1
	for i: int in slot_count:
		var subscriber_id: int = state.subscriber_ids[i]
		if subscriber_id == 0 or state.serials[i] >= serial_end:
			continue
		if not is_instance_id_valid(subscriber_id):
			_remove_destroyed_slot(state, i)
			continue
		state.callbacks[i].call(event)
		called += 1
		if _session != session:
			return
	state.depth -= 1
	LogCore.log_debug(_TAG, "publish %s: %d subscriptions called" % [state.type_name, called])


## Subscriptions of the subscriber with instance ID `subscriber_id`.
static func _count_subscriptions_of(subscriber_id: int) -> int:
	var count: int = 0
	var ref: int = _heads.get(subscriber_id, -1)
	while ref >= 0:
		ref = _type_list[ref >> 32].next_refs[ref & _SLOT_MASK]
		count += 1
	return count


## Subscription record slots of `type`, empty slots included.
static func _count_slots(type: Script) -> int:
	if not _types.has(type):
		return 0
	return _types[type].callbacks.size()


## True for a script whose base script is `EventBase`. `EventBase` itself and a type based on another event type are
## not event types.
static func _is_event_type(type: Script) -> bool:
	if type == null or not (type is GDScript):
		return false
	return type.get_base_script() == EventBase


## The state of event type `type`, made on first use.
static func _state_of(type: Script) -> _TYPE_STATE:
	if _types.has(type):
		return _types[type]
	var state: _TYPE_STATE = _TYPE_STATE.new()
	state.index = _type_list.size()
	state.type_name = String(type.get_global_name())
	if state.type_name.is_empty():
		state.type_name = type.resource_path
	_types[type] = state
	_type_list.append(state)
	return state


## Removes the subscriptions to the type of `state` whose subscriber was destroyed without unsubscribing. Subscriptions
## to other types stay until their own type is published.
static func _remove_destroyed(state: _TYPE_STATE) -> void:
	for i: int in state.subscriber_ids.size():
		var subscriber_id: int = state.subscriber_ids[i]
		if subscriber_id != 0 and not is_instance_id_valid(subscriber_id):
			_remove_destroyed_slot(state, i)


static func _remove_destroyed_slot(state: _TYPE_STATE, slot: int) -> void:
	_clear_slot(state, slot)
	LogCore.log_error(_TAG, "publish: removed a subscription to %s of a subscriber destroyed without unsubscribing" % state.type_name)


## Puts the subscription in `slot` of `state` first in the list of its subscriber.
static func _link_slot(state: _TYPE_STATE, slot: int, subscriber_id: int) -> void:
	var head: int = -1
	if _heads.has(subscriber_id):
		head = _heads[subscriber_id]
	elif _heads.size() > 2 * _subscriber_count:
		_drop_empty_heads()
	if head < 0:
		_subscriber_count += 1
	else:
		_type_list[head >> 32].prev_refs[head & _SLOT_MASK] = _slot_ref(state, slot)
	state.next_refs[slot] = head
	state.prev_refs[slot] = -1
	_heads[subscriber_id] = _slot_ref(state, slot)


## Removes the keys of `_heads` whose subscriber has no subscription. `subscribe` calls it before adding a key when at
## least half the keys are such, so `_heads` stays within twice the subscribers with a subscription plus one.
static func _drop_empty_heads() -> void:
	var heads: Dictionary[int, int] = {}
	for subscriber_id: int in _heads:
		if _heads[subscriber_id] >= 0:
			heads[subscriber_id] = _heads[subscriber_id]
	_heads = heads


static func _slot_ref(state: _TYPE_STATE, slot: int) -> int:
	return state.index << 32 | slot


static func _clear_slot(state: _TYPE_STATE, slot: int) -> void:
	var next: int = state.next_refs[slot]
	var prev: int = state.prev_refs[slot]
	if prev >= 0:
		_type_list[prev >> 32].next_refs[prev & _SLOT_MASK] = next
	else:
		_heads[state.subscriber_ids[slot]] = next
		if next < 0:
			_subscriber_count -= 1
	if next >= 0:
		_type_list[next >> 32].prev_refs[next & _SLOT_MASK] = prev
	state.next_refs[slot] = -1
	state.prev_refs[slot] = -1
	state.callbacks[slot] = Callable()
	state.subscriber_ids[slot] = 0


static func _reset() -> void:
	_is_initialized = false
	_node = null
	_session = null
	_types = {}
	_type_list = []
	_heads = {}
	_subscriber_count = 0
	_next_serial = 0
	_init_listeners = []


## Called by the core node when it leaves the tree. Outside `release` this is a tree teardown: clear like `release`
## without detaching the node.
static func _on_node_exit_tree(node: Node) -> void:
	if _is_initialized and node == _node:
		_reset()
