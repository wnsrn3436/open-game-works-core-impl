class_name InputBlockCore
extends RefCounted
## Puts and lifts input blocks and tells whether one input passes the active blocks. Taking or dropping the input is
## the work of `InputCore`; showing anything during a block is the work of the code that puts it.

const _TAG: String = "InputBlockCore"
const _MAX_DURATION_KEY: String = "InputBlockCore.maxDurationMs"
## Frames of this file are not the caller location of a block.
const _SELF_PATH: String = "res://core/input_block_core/input_block_core.gd"
const _CORE_NODE := preload("res://core/input_block_core/input_block_core_node.gd")
const _RUN_WAITER := preload("res://core/input_block_core/run_waiter.gd")

## Reason tags of `block`, `run_blocked` and `release_all`.
const _REASON_TAGS: PackedStringArray = [
	"network", "ui", "scene", "tween", "message", "cutscene", "tutorial", "ad", "boot", "content",
]
## A block token is `generation << _SLOT_BITS | slot`. The generation starts at 1, so 0 is never a good token.
const _SLOT_BITS: int = 20
const _SLOT_MASK: int = (1 << 20) - 1
const _MAX_SLOTS: int = 1 << 20
const _MAX_GENERATION: int = (1 << 42) - 1
const _INITIAL_SLOTS: int = 16
const _INVALID_TOKEN: int = 0
## `_owner_id_of` of a destroyed owner object. Godot never gives this instance ID: it needs every slot and validator bit.
const _DESTROYED_OWNER: int = -1

static var _is_initialized: bool = false
## Replaced by every `init`; an async operation that sees another session after `await` ends with its failure value.
static var _session: RefCounted = null
static var _node: Node = null
static var _max_duration_ms: int = 0

# Block slots. A slot is active while `_active` is 1; the free slots are `_free_slots[0, _free_count)`.
static var _slot_count: int = 0
static var _generation: PackedInt64Array = PackedInt64Array()
static var _active: PackedByteArray = PackedByteArray()
static var _reason: PackedStringArray = PackedStringArray()
static var _caller: PackedStringArray = PackedStringArray()
## Unheld time (`_unheld_now`) at `block` or the last `restart_timer`.
static var _start: PackedInt64Array = PackedInt64Array()
## Instance ID of the owner object. 0: no owner object.
static var _owner_id: PackedInt64Array = PackedInt64Array()
static var _pass_list: Array[BlockPassList] = []
static var _free_slots: PackedInt32Array = PackedInt32Array()
static var _free_count: int = 0
static var _active_count: int = 0

# Waiters of the `run_blocked` calls that have not returned, whether or not their block is still active; the running
# waiters are `_running[0, _running_count)`, and `_RUN_WAITER.index` is the index of one.
static var _running: Array[_RUN_WAITER] = []
static var _running_count: int = 0

# Timer hold. While a reason tag holds, the unheld time stands still.
static var _hold_ui: bool = false
static var _hold_network: bool = false
static var _hold_step: bool = false
## Real elapsed time when the running hold began.
static var _hold_started_at: int = 0
## Real elapsed time of the holds that ended.
static var _held_total_ms: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_MAX_DURATION_KEY):
		LogCore.log_error(_TAG, "init: core settings key InputBlockCore.maxDurationMs is missing or not an integer")
		return false
	_max_duration_ms = CoreSettings.get_int(_MAX_DURATION_KEY)
	_session = RefCounted.new()
	_grow(_INITIAL_SLOTS)
	var node: Node = _CORE_NODE.new()
	node.name = "InputBlockCore"
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	_node = node
	_is_initialized = true
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	_node = null
	_end_state()
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Puts a block. Returns its block token, or the invalid token 0.
# ogw:input_boundary
static func block(reason: String, pass_list: BlockPassList = null, owner: Variant = null) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "block: not initialized")
		return _INVALID_TOKEN
	var owner_id: int = 0
	if typeof(owner) != TYPE_NIL:
		owner_id = _owner_id_of(owner)
	return _put_block("block", reason, pass_list, owner_id)


static func unblock(token: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "unblock: not initialized")
		return false
	var slot: int = _slot_of(token)
	if slot < 0:
		LogCore.log_error(_TAG, "unblock: bad block token")
		return false
	_free_slot(slot)
	return true


## Async operation. Puts a block, calls `operation` and waits for it, then lifts the block. Returns the success flag of
## the operation, or `false` when the block could not be put, the owner object was destroyed or `release` came first.
# ogw:input_boundary
static func run_blocked(reason: String, operation: Callable, pass_list: BlockPassList = null, owner: Variant = null) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "run_blocked: not initialized")
		return false
	if not operation.is_valid():
		LogCore.log_error(_TAG, "run_blocked: operation is not a valid callable")
		return false
	var owner_id: int = 0
	if typeof(owner) != TYPE_NIL:
		owner_id = _owner_id_of(owner)
	elif is_instance_id_valid(operation.get_object_id()):
		owner_id = operation.get_object_id()
	var token: int = _put_block("run_blocked", reason, pass_list, owner_id)
	if token == _INVALID_TOKEN:
		return false
	var session: RefCounted = _session
	var waiter: _RUN_WAITER = _RUN_WAITER.new()
	waiter.owner_id = owner_id
	_add_running(waiter)
	waiter.start(operation)
	# A `release` in the part of the operation before its first `await` emitted `done` before anyone waited for it.
	if not waiter.finished and session == _session:
		await waiter.done
	if session != _session:
		return false
	_remove_running(waiter)
	if waiter.aborted:
		return false
	var slot: int = _slot_of(token)
	if slot >= 0:
		_free_slot(slot)
	return waiter.result


static func is_blocked() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_blocked: not initialized")
		return false
	return _active_count > 0


static func is_active(token: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_active: not initialized")
		return false
	return _slot_of(token) >= 0


static func pass_action(action: StringName) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "pass_action: not initialized")
		return true
	if _active_count == 0:
		return true
	for slot: int in _slot_count:
		if _active[slot] == 0:
			continue
		var pass_list: BlockPassList = _pass_list[slot]
		if pass_list == null or not pass_list.actions.has(action):
			return false
	return true


## `position` is a window pixel position: under `ResolutionCoreDev.set_test_screen`, a pixel of the test window size.
static func pass_position(position: Vector2) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "pass_position: not initialized")
		return true
	if _active_count == 0:
		return true
	if not position.is_finite():
		LogCore.log_error(_TAG, "pass_position: position is not finite")
		return false
	var real_position: Vector2 = _to_real_window(position)
	for slot: int in _slot_count:
		if _active[slot] == 0:
			continue
		var pass_list: BlockPassList = _pass_list[slot]
		if pass_list == null or not _passes_position(pass_list, real_position):
			return false
	return true


## `element` is a UI element (`Control`). A destroyed one does not pass.
# ogw:input_boundary
static func pass_focus(element: Variant) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "pass_focus: not initialized")
		return true
	if typeof(element) != TYPE_OBJECT or not is_instance_valid(element) or not (element is Control):
		return false
	var control: Control = element
	if _active_count == 0:
		return true
	for slot: int in _slot_count:
		if _active[slot] == 0:
			continue
		var pass_list: BlockPassList = _pass_list[slot]
		if pass_list == null or not _passes_focus(pass_list, control):
			return false
	return true


## Lifts every active block but the blocks of `keep` (an empty string keeps none). Returns the number lifted.
static func release_all(keep: String = "") -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "release_all: not initialized")
		return 0
	if not keep.is_empty() and not _REASON_TAGS.has(keep):
		LogCore.log_error(_TAG, "release_all: unknown reason tag " + keep)
		return 0
	var count: int = 0
	for slot: int in _slot_count:
		if _active[slot] == 0 or _reason[slot] == keep:
			continue
		LogCore.log_warn(_TAG, "release_all: released block reason=%s caller=%s" % [_reason[slot], _caller[slot]])
		_free_slot(slot)
		count += 1
	return count


static func set_timer_hold(reason: String, hold: bool) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_timer_hold: not initialized")
		return
	var was_holding: bool = _is_holding()
	match reason:
		"ui":
			_hold_ui = hold
		"network":
			_hold_network = hold
		"step":
			_hold_step = hold
		_:
			LogCore.log_error(_TAG, "set_timer_hold: unknown reason tag " + reason)
			return
	var holding: bool = _is_holding()
	if holding and not was_holding:
		_hold_started_at = TimeCore.get_real_time()
	elif was_holding and not holding:
		_held_total_ms += TimeCore.get_real_time() - _hold_started_at


static func restart_timer(token: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "restart_timer: not initialized")
		return false
	var slot: int = _slot_of(token)
	if slot < 0:
		return false
	_start[slot] = _unheld_now()
	return true


# The frame check of the core node: lifts the blocks whose owner object was destroyed and the blocks whose block
# elapsed time reached `InputBlockCore.maxDurationMs`, then ends the `run_blocked` calls whose owner object was
# destroyed, also those whose block was lifted before.
static func _check_blocks() -> void:
	if not _is_initialized:
		return
	if _active_count > 0:
		var now: int = _unheld_now()
		for slot: int in _slot_count:
			if _active[slot] == 0:
				continue
			var owner_id: int = _owner_id[slot]
			if owner_id != 0 and not is_instance_id_valid(owner_id):
				_free_slot(slot)
				continue
			if _is_exempt(_reason[slot]):
				continue
			var elapsed: int = now - _start[slot]
			if elapsed >= _max_duration_ms:
				_log_forced_release(slot, elapsed)
				_free_slot(slot)
	var session: RefCounted = _session
	# A woken call removes its waiter, and the last running waiter takes its index; going down from the end, that
	# waiter was already checked. Waiters added by the woken code are checked in the next frame.
	var i: int = _running_count - 1
	while i >= 0:
		if i < _running_count:
			var waiter: _RUN_WAITER = _running[i]
			if waiter.owner_id != 0 and not is_instance_id_valid(waiter.owner_id):
				waiter.aborted = true
				waiter.done.emit()
				if session != _session:
					return
		i -= 1


static func _on_node_exit(node: Node) -> void:
	if node != _node or not _is_initialized:
		return
	_node = null
	_end_state()


# Clears every block and hold, then wakes the `run_blocked` calls that wait, also those whose block was lifted before;
# they see the new session and end.
static func _end_state() -> void:
	var waiters: Array[_RUN_WAITER] = _running
	var waiter_count: int = _running_count
	_running = []
	_running_count = 0
	_is_initialized = false
	_session = null
	_max_duration_ms = 0
	_slot_count = 0
	_generation = PackedInt64Array()
	_active = PackedByteArray()
	_reason = PackedStringArray()
	_caller = PackedStringArray()
	_start = PackedInt64Array()
	_owner_id = PackedInt64Array()
	_pass_list = []
	_free_slots = PackedInt32Array()
	_free_count = 0
	_active_count = 0
	_hold_ui = false
	_hold_network = false
	_hold_step = false
	_hold_started_at = 0
	_held_total_ms = 0
	for i: int in waiter_count:
		waiters[i].done.emit()


static func _put_block(operation: String, reason: String, pass_list: BlockPassList, owner_id: int) -> int:
	if not _REASON_TAGS.has(reason):
		LogCore.log_error(_TAG, operation + ": unknown reason tag " + reason)
		return _INVALID_TOKEN
	if owner_id == _DESTROYED_OWNER:
		LogCore.log_error(_TAG, operation + ": owner object is destroyed")
		return _INVALID_TOKEN
	if _free_count == 0:
		if _slot_count >= _MAX_SLOTS:
			LogCore.log_error(_TAG, operation + ": too many active blocks")
			return _INVALID_TOKEN
		_grow(mini(_slot_count * 2, _MAX_SLOTS))
	_free_count -= 1
	var slot: int = _free_slots[_free_count]
	_active[slot] = 1
	_reason[slot] = reason
	_caller[slot] = _caller_location()
	_start[slot] = _unheld_now()
	_owner_id[slot] = owner_id
	_pass_list[slot] = pass_list
	_active_count += 1
	return (_generation[slot] << _SLOT_BITS) | slot


# Instance ID of an owner object that is not null; `_DESTROYED_OWNER` when it is destroyed or not an object. The ID of
# a `RefCounted` object is negative, so a negative ID is a live owner object.
# ogw:input_boundary
static func _owner_id_of(owner: Variant) -> int:
	if typeof(owner) != TYPE_OBJECT or not is_instance_valid(owner):
		return _DESTROYED_OWNER
	var object: Object = owner
	return object.get_instance_id()


static func _add_running(waiter: _RUN_WAITER) -> void:
	if _running_count == _running.size():
		_running.resize(maxi(_INITIAL_SLOTS, _running_count * 2))
	_running[_running_count] = waiter
	waiter.index = _running_count
	_running_count += 1


# Removes a running waiter without changing the size of `_running`: the last running waiter takes its index.
static func _remove_running(waiter: _RUN_WAITER) -> void:
	var last: int = _running_count - 1
	var moved: _RUN_WAITER = _running[last]
	_running[waiter.index] = moved
	moved.index = waiter.index
	_running[last] = null
	_running_count = last
	waiter.index = -1


static func _free_slot(slot: int) -> void:
	_active[slot] = 0
	_reason[slot] = ""
	_caller[slot] = ""
	_owner_id[slot] = 0
	_pass_list[slot] = null
	_generation[slot] = 1 if _generation[slot] >= _MAX_GENERATION else _generation[slot] + 1
	_free_slots[_free_count] = slot
	_free_count += 1
	_active_count -= 1


# Slot of a good token, or -1 for a bad token.
static func _slot_of(token: int) -> int:
	if token <= 0:
		return -1
	var slot: int = token & _SLOT_MASK
	if slot >= _slot_count or _active[slot] == 0 or _generation[slot] != token >> _SLOT_BITS:
		return -1
	return slot


static func _grow(count: int) -> void:
	var old: int = _slot_count
	_generation.resize(count)
	_active.resize(count)
	_reason.resize(count)
	_caller.resize(count)
	_start.resize(count)
	_owner_id.resize(count)
	_pass_list.resize(count)
	_free_slots.resize(count)
	# the lowest new slot is taken first
	for slot: int in range(count - 1, old - 1, -1):
		_generation[slot] = 1
		_active[slot] = 0
		_owner_id[slot] = 0
		_free_slots[_free_count] = slot
		_free_count += 1
	_slot_count = count


static func _is_holding() -> bool:
	return _hold_ui or _hold_network or _hold_step


# Real elapsed time less the timer hold time. The block elapsed time of a block is the growth of this value.
static func _unheld_now() -> int:
	if _is_holding():
		return _hold_started_at - _held_total_ms
	return TimeCore.get_real_time() - _held_total_ms


static func _is_exempt(reason: String) -> bool:
	return reason == "scene" or reason == "cutscene" or reason == "tutorial" or reason == "ad" or reason == "boot"


## Window pixel position to the pixel of the real window, the space of `Viewport.get_screen_transform`. A window pixel
## of a `ResolutionCoreDev.set_test_screen` window size is a real pixel × (that window size ÷ real window size) on
## each axis. Without `ResolutionCore` there is no test screen, so the two are the same.
static func _to_real_window(position: Vector2) -> Vector2:
	if not ResolutionCore.is_initialized():
		return position
	var window: Vector2i = ResolutionCore.get_window_size()
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or window.x <= 0 or window.y <= 0:
		return position
	var real: Vector2i = tree.root.size
	if real.x <= 0 or real.y <= 0 or real == window:
		return position
	return Vector2(position.x * real.x / window.x, position.y * real.y / window.y)


## `position` is a pixel of the real window.
static func _passes_position(pass_list: BlockPassList, position: Vector2) -> bool:
	for i: int in pass_list.elements.size():
		if not is_instance_valid(pass_list.elements[i]):
			continue
		var element: Control = pass_list.elements[i]
		if not element.is_visible_in_tree():
			continue
		var to_window: Transform2D = element.get_viewport().get_screen_transform() * element.get_global_transform_with_canvas()
		var local: Vector2 = to_window.affine_inverse() * position
		if Rect2(Vector2.ZERO, element.size).has_point(local):
			return true
	return false


static func _passes_focus(pass_list: BlockPassList, control: Control) -> bool:
	for i: int in pass_list.elements.size():
		if not is_instance_valid(pass_list.elements[i]):
			continue
		var element: Control = pass_list.elements[i]
		if element.is_visible_in_tree() and (element == control or element.is_ancestor_of(control)):
			return true
	return false


# `<file>:<line>` of the first script frame outside this file, or an empty string.
static func _caller_location() -> String:
	var traces: Array[ScriptBacktrace] = Engine.capture_script_backtraces(false)
	for trace: ScriptBacktrace in traces:
		for i: int in trace.get_frame_count():
			var file: String = trace.get_frame_file(i)
			if file.is_empty() or file == _SELF_PATH:
				continue
			return "%s:%d" % [file, trace.get_frame_line(i)]
	return ""


static func _log_forced_release(slot: int, elapsed: int) -> void:
	LogCore.log_error(_TAG, "forced release: reason=%s caller=%s elapsed_ms=%d" % [_reason[slot], _caller[slot], elapsed])
