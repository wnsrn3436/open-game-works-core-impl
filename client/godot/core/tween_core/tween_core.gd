class_name TweenCore
extends RefCounted
## Tweens: the property values of one object changed over time, tween presets, and value tweens that pass their
## frame values to a receiver. Code outside TweenCore does not use the engine tween.

enum TweenProperty { POSITION, ROTATION, SCALE, COLOR, OPACITY }
enum TweenValueKind { FLOAT, VECTOR2, COLOR }
enum TweenEndReason { NONE, COMPLETED, SKIPPED, STOPPED, TARGET_DESTROYED }
enum Easing {
	LINEAR,
	QUAD_IN,
	QUAD_OUT,
	QUAD_IN_OUT,
	CUBIC_IN,
	CUBIC_OUT,
	CUBIC_IN_OUT,
	SINE_IN,
	SINE_OUT,
	SINE_IN_OUT,
	BACK_IN,
	BACK_OUT,
	BACK_IN_OUT,
	ELASTIC_OUT,
	BOUNCE_OUT,
}
enum TimeBasis { REAL_TIME, GAME_TIME }

const _TAG: String = "TweenCore"
const _MAX_DURATION_KEY: String = "TweenCore.maxDurationMs"
const _MAX_REPEAT_KEY: String = "TweenCore.maxRepeatCount"
## `InputBlockCore` reason tag of the tween input block.
const _REASON_TAG: String = "tween"
const _CORE_NODE := preload("res://core/tween_core/tween_core_node.gd")
const _RECORD := preload("res://core/tween_core/tween_record.gd")
const _CHANGE := preload("res://core/tween_core/change_state.gd")
const _WAITER := preload("res://core/tween_core/end_waiter.gd")

const _INVALID_HANDLE: int = 0
## `ResourceCore` invalid kind.
const _INVALID_KIND: int = -1
## A handle is `generation << _SLOT_BITS | slot`. The generation starts at 1, so 0 is never a handle.
const _SLOT_BITS: int = 20
const _SLOT_MASK: int = (1 << 20) - 1
const _MAX_SLOTS: int = 1 << 20
const _MAX_GENERATION: int = (1 << 42) - 1
const _INITIAL_SLOTS: int = 16

## Property masks. `Color` and `Opacity` are one property.
const _MASK_POSITION: int = 1
const _MASK_ROTATION: int = 2
const _MASK_SCALE: int = 4
const _MASK_COLOR: int = 8

const _BACK_C1: float = 1.70158
const _BACK_C2: float = 1.70158 * 1.525
const _BACK_C3: float = 1.70158 + 1.0
const _ELASTIC_C4: float = TAU / 3.0
const _BOUNCE_N1: float = 7.5625
const _BOUNCE_D1: float = 2.75

static var _is_initialized: bool = false
## Session of this init. A preset load that resumes in another session does nothing.
static var _session: RefCounted = null
static var _node: Node = null
static var _max_duration_ms: int = 0
static var _max_repeat_count: int = 0
## `ResourceCore` kind of tween presets.
static var _preset_kind: int = _INVALID_KIND
## Options of a call without options.
static var _default_options: TweenOptions = null
## `_flush_end_due`, made in `init`.
static var _flush: Callable = Callable()
## `_load_preset`, made in `init`. `play_preset` queues it as a deferred call: frame code calls `play_preset`, and
## frame code does no `await`.
static var _load_preset_call: Callable = Callable()
## A deferred `_flush_end_due` call is queued, and the session it was queued in.
static var _flush_queued: bool = false
static var _flush_session: RefCounted = null

static var _slot_count: int = 0
static var _generation: PackedInt64Array = PackedInt64Array()
static var _active: PackedByteArray = PackedByteArray()
static var _records: Array[_RECORD] = []
static var _free_slots: PackedInt32Array = PackedInt32Array()
static var _free_count: int = 0
static var _active_count: int = 0
## Index of the property tweens (waiting ones too) by target: the target instance ID picks one of `_slot_count`
## buckets, and the slots of a bucket are a doubly linked list. -1 ends a list.
static var _bucket_first: PackedInt32Array = PackedInt32Array()
static var _target_next: PackedInt32Array = PackedInt32Array()
static var _target_prev: PackedInt32Array = PackedInt32Array()
## The property tween slots in a dense list, and the index of each slot in it (-1 when it is not there).
static var _property_slots: PackedInt32Array = PackedInt32Array()
static var _property_index: PackedInt32Array = PackedInt32Array()
static var _property_count: int = 0
## Handles of the tweens the running target, tag and pool return operations end. An operation started by a callback
## meanwhile pushes its handles above them.
static var _end_handles: PackedInt64Array = PackedInt64Array()
static var _end_top: int = 0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_MAX_DURATION_KEY):
		LogCore.log_error(_TAG, "init: core settings key TweenCore.maxDurationMs is missing or not an integer")
		return false
	if not CoreSettings.has_int(_MAX_REPEAT_KEY):
		LogCore.log_error(_TAG, "init: core settings key TweenCore.maxRepeatCount is missing or not an integer")
		return false
	if not ResourceCore.is_initialized() or not PoolCore.is_initialized():
		LogCore.log_error(_TAG, "init: ResourceCore or PoolCore is not initialized")
		return false
	var kind: int = ResourceCore.register_kind(TweenDefinition, TweenDefinition.new())
	if kind == _INVALID_KIND:
		LogCore.log_error(_TAG, "init: ResourceCore did not register the tween preset kind")
		return false
	PoolCore.add_return_cleaner(_on_pool_return)
	_preset_kind = kind
	_max_duration_ms = CoreSettings.get_int(_MAX_DURATION_KEY)
	_max_repeat_count = CoreSettings.get_int(_MAX_REPEAT_KEY)
	_session = RefCounted.new()
	_default_options = TweenOptions.new()
	_flush = _flush_end_due
	_load_preset_call = _load_preset
	_grow(_INITIAL_SLOTS)
	var node: Node = _CORE_NODE.new()
	node.name = "TweenCore"
	# UI tweens play during the game time pause.
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


## Plays `definition` on `target`. Returns the tween handle, or the invalid handle 0.
# ogw:input_boundary
static func play(definition: TweenDefinition, target: Variant, options: TweenOptions = null) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "play: not initialized")
		return _INVALID_HANDLE
	var object: Object = _object_of(target)
	if object == null:
		LogCore.log_error(_TAG, "play: the target object is missing or destroyed")
		return _INVALID_HANDLE
	var used: TweenOptions = options if options != null else _default_options
	if not _is_time_basis(used.time_basis):
		LogCore.log_error(_TAG, "play: the time basis is not a TimeBasis member")
		return _INVALID_HANDLE
	var target_id: int = object.get_instance_id()
	_stop_pending_of(target_id)
	var checked: TweenDefinition = _checked(definition, object, "play")
	if not is_instance_id_valid(target_id):
		LogCore.log_error(_TAG, "play: the target object was destroyed by the end of an earlier tween")
		return _INVALID_HANDLE
	return _start_property(checked, target_id, used)


## Loads the tween preset `key` with `scope` and plays it on `target` when it loaded. Returns the tween handle, or the
## invalid handle 0.
# ogw:input_boundary
static func play_preset(key: String, scope: Scope, target: Variant, options: TweenOptions = null) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "play_preset: not initialized")
		return _INVALID_HANDLE
	var object: Object = _object_of(target)
	if object == null:
		LogCore.log_error(_TAG, "play_preset: the target object is missing or destroyed")
		return _INVALID_HANDLE
	var used: TweenOptions = options if options != null else _default_options
	if not _is_time_basis(used.time_basis):
		LogCore.log_error(_TAG, "play_preset: the time basis is not a TimeBasis member")
		return _INVALID_HANDLE
	var target_id: int = object.get_instance_id()
	_stop_pending_of(target_id)
	if not is_instance_id_valid(target_id):
		LogCore.log_error(_TAG, "play_preset: the target object was destroyed by the end of an earlier tween")
		return _INVALID_HANDLE
	if ResourceCore.is_loaded(key, _preset_kind):
		var loaded: Resource = ResourceCore.get_loaded(key, _preset_kind, scope)
		var checked: TweenDefinition = _checked(loaded as TweenDefinition, object, "play_preset")
		if not is_instance_id_valid(target_id):
			LogCore.log_error(_TAG, "play_preset: the target object was destroyed by the end of an earlier tween")
			return _INVALID_HANDLE
		return _start_property(checked, target_id, used)
	var slot: int = _take_slot()
	if slot < 0:
		LogCore.log_error(_TAG, "play_preset: no free tween slot")
		return _INVALID_HANDLE
	var record: _RECORD = _records[slot]
	_set_property_record(slot, target_id, used)
	record.pending = true
	var handle: int = record.handle
	_load_preset_call.call_deferred(handle, key, scope, _session)
	return handle


## Plays a value tween from `start_value` to `end_value` with the duration and easing of the first change of
## `definition`, and calls `receiver` with the value of each frame. Returns the tween handle, or the invalid handle 0.
static func play_value(
	kind: TweenValueKind, start_value: Vector4, end_value: Vector4, definition: TweenDefinition, receiver: Callable
) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "play_value: not initialized")
		return _INVALID_HANDLE
	if kind < 0 or kind >= TweenValueKind.size():
		LogCore.log_error(_TAG, "play_value: the value kind is not a TweenValueKind member")
		return _INVALID_HANDLE
	if not receiver.is_valid():
		LogCore.log_error(_TAG, "play_value: the value receiver is missing or destroyed")
		return _INVALID_HANDLE
	var change: TweenChange = _first_change(definition)
	if change == null:
		LogCore.log_error(_TAG, "play_value: the definition is missing or has no first change")
		return _INVALID_HANDLE
	if change.duration < 0 or change.duration > _max_duration_ms:
		LogCore.log_error(
			_TAG, "play_value: duration %d ms is below 0 or above TweenCore.maxDurationMs" % change.duration
		)
		return _INVALID_HANDLE
	if not _is_easing(change.easing):
		LogCore.log_error(_TAG, "play_value: the easing is not an Easing member")
		return _INVALID_HANDLE
	var used: int = _value_components(kind)
	if not _is_finite_vector(start_value, used) or not _is_finite_vector(end_value, used):
		LogCore.log_error(_TAG, "play_value: the start value or the end value is not a finite number")
		return _INVALID_HANDLE
	var slot: int = _take_slot()
	if slot < 0:
		LogCore.log_error(_TAG, "play_value: no free tween slot")
		return _INVALID_HANDLE
	var record: _RECORD = _records[slot]
	record.is_value = true
	record.receiver = receiver
	record.value_kind = kind
	record.time_basis = TimeBasis.REAL_TIME
	record.reserve(1, 1)
	var state: _CHANGE = record.changes[0]
	state.property = -1
	state.target = end_value
	state.use_start = true
	state.start_value = start_value
	state.duration = change.duration
	state.delay = 0
	state.easing = change.easing
	record.step_first[0] = 0
	record.step_size[0] = 1
	record.step_max[0] = change.duration
	record.step_count = 1
	record.change_count = 1
	record.cycle_ms = change.duration
	record.repeat_count = 1
	var handle: int = record.handle
	_begin(record)
	return handle


## Ends the tween with `Stopped`. The property values stay as they are.
static func stop(handle: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "stop: not initialized")
		return
	var slot: int = _slot_of(handle)
	if slot >= 0:
		_end(slot, TweenEndReason.STOPPED)


## Ends the tween with `Skipped` and sets its end state.
static func skip_to_end(handle: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "skip_to_end: not initialized")
		return
	var slot: int = _slot_of(handle)
	if slot >= 0:
		_end(slot, TweenEndReason.SKIPPED)


## Ends every tween of `target` with `Stopped`. Returns the number ended.
# ogw:input_boundary
static func stop_target(target: Variant) -> int:
	return _end_target("stop_target", target, TweenEndReason.STOPPED)


## Ends every tween of `target` with `Skipped`. Returns the number ended.
# ogw:input_boundary
static func skip_target_to_end(target: Variant) -> int:
	return _end_target("skip_target_to_end", target, TweenEndReason.SKIPPED)


## Ends every tween of tag `tag` with `Stopped`. Returns the number ended.
static func stop_tag(tag: String) -> int:
	return _end_tag("stop_tag", tag, TweenEndReason.STOPPED)


## Ends every tween of tag `tag` with `Skipped`. Returns the number ended.
static func skip_tag_to_end(tag: String) -> int:
	return _end_tag("skip_tag_to_end", tag, TweenEndReason.SKIPPED)


static func is_playing(handle: int) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_playing: not initialized")
		return false
	return _slot_of(handle) >= 0


## Number of the playing tweens that do not repeat forever: value tweens, presets that wait for loading, and tweens
## whose played definition has a repeat count other than 0. Allocates no memory.
static func get_finite_playing_count() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_finite_playing_count: not initialized")
		return 0
	var count: int = 0
	for slot: int in _slot_count:
		# value tweens, waiting presets and definitions without step have repeat count 1 in their record
		if _active[slot] != 0 and _records[slot].repeat_count != 0:
			count += 1
	return count


## Async operation. Waits until the tween ends and returns its end reason. `None` at once when it is not playing, and
## when `release` ends it.
static func wait_end(handle: int) -> TweenEndReason:
	if not _is_initialized:
		LogCore.log_error(_TAG, "wait_end: not initialized")
		return TweenEndReason.NONE
	var slot: int = _slot_of(handle)
	if slot < 0:
		return TweenEndReason.NONE
	var record: _RECORD = _records[slot]
	if record.waiter == null:
		record.waiter = _WAITER.new()
	var waiter: _WAITER = record.waiter
	await waiter.done
	return waiter.reason


## Fills `copy` with the values of `source`, reusing the steps and changes `copy` has. Returns the success flag.
static func copy_definition(source: TweenDefinition, copy: TweenDefinition) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "copy_definition: not initialized")
		return false
	if copy == null or source == copy:
		LogCore.log_error(_TAG, "copy_definition: the copy is missing or is the source")
		return false
	if source == null:
		LogCore.log_error(_TAG, "copy_definition: the source is missing; the copy has no step")
		copy.steps.clear()
		return false
	copy.repeat_count = source.repeat_count
	if is_same(copy.steps, source.steps):
		var steps: Array[TweenStep] = []
		copy.steps = steps
	var step_count: int = source.steps.size()
	copy.steps.resize(step_count)
	for s: int in step_count:
		var source_step: TweenStep = source.steps[s]
		if source_step == null:
			copy.steps[s] = null
			continue
		var step: TweenStep = copy.steps[s]
		if step == null or source.steps.has(step):
			step = TweenStep.new()
			copy.steps[s] = step
		_copy_changes(source_step, step)
	return true


## The `ResourceCore` kind of tween presets.
static func get_preset_kind() -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_preset_kind: not initialized")
		return _INVALID_KIND
	return _preset_kind


## Whether `definition` on `target` passes the definition check. Plays nothing and logs no failed item.
# ogw:input_boundary
static func check_definition(definition: TweenDefinition, target: Variant) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "check_definition: not initialized")
		return false
	var object: Object = _object_of(target)
	if definition == null or object == null:
		LogCore.log_error(_TAG, "check_definition: the definition or the target object is missing or destroyed")
		return false
	return _check_failure(definition, object) == ""


## The value of `easing` at `progress`, the same formula as the tween frame values. Progress is clamped to 0..1.
static func evaluate_easing(easing: Easing, progress: float) -> float:
	if not _is_initialized:
		LogCore.log_error(_TAG, "evaluate_easing: not initialized")
		return 0.0
	if not is_finite(progress):
		LogCore.log_error(_TAG, "evaluate_easing: the progress is not a finite number")
		return 0.0
	if not _is_easing(easing):
		LogCore.log_error(_TAG, "evaluate_easing: the easing is not an Easing member")
		return 0.0
	return _ease(easing, progress)


# --- start ---


## `definition` when it passes the definition check on `object`, else `null` (no step) with an error log. A missing
## definition or another resource is a preset that did not load: `ResourceCore` logged it.
static func _checked(definition: TweenDefinition, object: Object, operation: String) -> TweenDefinition:
	if definition == null:
		if operation == "play":
			LogCore.log_error(_TAG, "play: definition check failed: no definition")
		return null
	var failure: String = _check_failure(definition, object)
	if failure == "":
		return definition
	LogCore.log_error(_TAG, "%s: definition check failed: %s" % [operation, failure])
	return null


## Starts a property tween of `definition` (`null` is no step) on the target. Returns its handle.
static func _start_property(definition: TweenDefinition, target_id: int, options: TweenOptions) -> int:
	_stop_conflicts(target_id, _mask_of_definition(definition), -1)
	var slot: int = _take_slot()
	if slot < 0:
		LogCore.log_error(_TAG, "play: no free tween slot")
		return _INVALID_HANDLE
	var record: _RECORD = _records[slot]
	_set_property_record(slot, target_id, options)
	_load_definition(record, definition)
	var handle: int = record.handle
	_begin(record)
	return handle


static func _set_property_record(slot: int, target_id: int, options: TweenOptions) -> void:
	var record: _RECORD = _records[slot]
	record.target_id = target_id
	_link_target(slot)
	record.time_basis = options.time_basis
	record.tag = options.tag
	record.callback = options.callback
	if options.input_block:
		record.block_token = InputBlockCore.block(_REASON_TAG, options.block_pass_list)


## Deferred call: loads the tween preset of a `play_preset` tween and starts the tween when it loaded. A tween that
## ended before the call loads nothing.
static func _load_preset(handle: int, key: String, scope: Scope, session: RefCounted) -> void:
	if session != _session or _slot_of(handle) < 0:
		return
	var resource: Resource = await ResourceCore.load(key, _preset_kind, scope)
	if session != _session:
		return
	var slot: int = _slot_of(handle)
	if slot < 0:
		return
	var record: _RECORD = _records[slot]
	if not record.pending or not is_instance_id_valid(record.target_id):
		# a destroyed target ends with `TargetDestroyed` in the frame processing
		return
	var definition: TweenDefinition = _checked(
		resource as TweenDefinition, instance_from_id(record.target_id), "play_preset"
	)
	_stop_conflicts(record.target_id, _mask_of_definition(definition), slot)
	if _slot_of(handle) != slot:
		return
	record.pending = false
	_load_definition(record, definition)
	_begin(record)


## Copies `definition` (`null` is no step) into `record`. The definition passed the definition check.
static func _load_definition(record: _RECORD, definition: TweenDefinition) -> void:
	record.step_count = 0
	record.change_count = 0
	record.cycle_ms = 0
	record.mask = 0
	record.repeat_count = 1
	if definition == null:
		return
	var step_count: int = definition.steps.size()
	var change_total: int = 0
	for step: TweenStep in definition.steps:
		change_total += step.changes.size()
	record.reserve(step_count, change_total)
	record.repeat_count = definition.repeat_count
	for s: int in step_count:
		var step: TweenStep = definition.steps[s]
		var longest: int = 0
		record.step_first[s] = record.change_count
		record.step_size[s] = step.changes.size()
		for change: TweenChange in step.changes:
			var state: _CHANGE = record.changes[record.change_count]
			state.property = change.property
			state.target = change.target_value
			state.use_start = change.use_start_value
			state.start_value = change.start_value
			state.duration = change.duration
			state.delay = change.delay
			state.easing = change.easing
			record.mask |= _mask_of(change.property)
			record.change_count += 1
			longest = maxi(longest, change.delay + change.duration)
		record.step_max[s] = longest
		record.cycle_ms += longest
	record.step_count = step_count


## Starts the progress of a loaded record and publishes `TweenStartedEvent`. A record without cycle time ends with
## `Completed` before the frame ends.
static func _begin(record: _RECORD) -> void:
	record.last_time = _now(record.time_basis)
	record.cycle_index = 0
	record.step_index = 0
	record.step_elapsed = 0
	record.reset_cycle()
	if record.block_token != 0 and record.repeat_count == 0:
		LogCore.log_error(_TAG, "an input block tween repeats forever; its block is lifted")
		_unblock(record)
	if record.cycle_ms == 0:
		record.end_due = true
		if not _flush_queued:
			_flush_queued = true
			_flush_session = _session
			_flush.call_deferred()
	var event: TweenStartedEvent = EventCore.acquire(TweenStartedEvent) as TweenStartedEvent
	if event != null:
		EventCore.publish(event)


## Deferred call: ends the tweens that started with an end condition in their playing operation.
static func _flush_end_due() -> void:
	if not _is_initialized or _flush_session != _session:
		return
	_flush_queued = false
	_flush_session = null
	var session: RefCounted = _session
	for slot: int in _slot_count:
		if _active[slot] != 0 and _records[slot].end_due:
			_end(slot, TweenEndReason.COMPLETED)
			# a callback released TweenCore
			if session != _session:
				return


# --- frame ---


## Frame processing of the core node: target destruction and progress.
static func _on_frame() -> void:
	if not _is_initialized or _active_count == 0 or not TimeCore.is_initialized():
		return
	var real_now: int = TimeCore.get_real_time()
	var game_now: int = TimeCore.get_game_time()
	var session: RefCounted = _session
	var count: int = _slot_count
	for slot: int in count:
		if _active[slot] == 0:
			continue
		var record: _RECORD = _records[slot]
		if record.end_due:
			continue
		if _is_gone(record):
			_end(slot, TweenEndReason.TARGET_DESTROYED)
		elif not record.pending:
			var now: int = real_now if record.time_basis == TimeBasis.REAL_TIME else game_now
			if _advance(record, now):
				_end(slot, TweenEndReason.COMPLETED)
		# a callback, a receiver or a property write released TweenCore
		if session != _session:
			return


static func _is_gone(record: _RECORD) -> bool:
	if record.is_value:
		return not record.receiver.is_valid()
	return not is_instance_id_valid(record.target_id)


## Moves the tween to `now` and sets the values of this frame. Returns true when the last cycle ended. Returns false
## at once when a receiver or a property write ended the tween or destroyed its target: the record may hold another
## tween by then.
static func _advance(record: _RECORD, now: int) -> bool:
	var dt: int = now - record.last_time
	record.last_time = now
	if dt < 0:
		dt = 0
	var object: Object = null
	if not record.is_value:
		object = instance_from_id(record.target_id)
	while true:
		var remaining: int = record.step_max[record.step_index] - record.step_elapsed
		if dt < remaining:
			record.step_elapsed += dt
			_set_step_values(record, object, false)
			return false
		dt -= remaining
		record.step_elapsed = record.step_max[record.step_index]
		if not _set_step_values(record, object, true):
			return false
		record.step_index += 1
		record.step_elapsed = 0
		if record.step_index < record.step_count:
			continue
		record.step_index = 0
		record.cycle_index += 1
		if record.repeat_count > 0 and record.cycle_index >= record.repeat_count:
			return true
		# whole cycles in one frame leave the values of a finished cycle: skip them
		if dt >= record.cycle_ms:
			@warning_ignore("integer_division")
			var cycles: int = dt / record.cycle_ms
			if record.repeat_count > 0:
				cycles = mini(cycles, record.repeat_count - record.cycle_index)
			record.cycle_index += cycles
			dt -= cycles * record.cycle_ms
			if record.repeat_count > 0 and record.cycle_index >= record.repeat_count:
				return true
		record.reset_cycle()
	return false


## Sets the values of the changes of the current step at its elapsed time. `finish` sets every change to its target.
## Returns false when a receiver or a property write ended the tween or destroyed its target; it then sets no more
## value.
static func _set_step_values(record: _RECORD, object: Object, finish: bool) -> bool:
	var handle: int = record.handle
	var i: int = record.step_first[record.step_index]
	var end: int = i + record.step_size[record.step_index]
	while i < end:
		var change: _CHANGE = record.changes[i]
		i += 1
		if change.finished:
			continue
		var local: int = record.step_elapsed - change.delay
		if not finish and local < 0:
			continue
		if not change.started:
			change.started = true
			change.arranged = not record.is_value and _is_arranged(object)
			if not finish and local < change.duration:
				change.start = (
					change.start_value if change.use_start else _read(object, change.property, change.arranged)
				)
		if finish or local >= change.duration:
			change.finished = true
			_set_value(record, object, change, change.target)
		else:
			var progress: float = float(local) / float(change.duration)
			var value: Vector4 = change.start + (change.target - change.start) * _ease(change.easing, progress)
			_set_value(record, object, change, value)
		if record.handle != handle or _is_gone(record):
			return false
	return true


static func _set_value(record: _RECORD, object: Object, change: _CHANGE, value: Vector4) -> void:
	if not record.is_value:
		_write(object, change.property, value, change.arranged)
		return
	match record.value_kind:
		TweenValueKind.FLOAT:
			record.receiver.call(value.x)
		TweenValueKind.VECTOR2:
			record.receiver.call(Vector2(value.x, value.y))
		TweenValueKind.COLOR:
			record.receiver.call(Color(value.x, value.y, value.z, value.w))


# --- end ---


## End processing: end state, input block, handle, callback, `wait_end`. Returns false and does nothing when the slot
## has no tween or its tween is already ending: a receiver, a property write or a callback of the end state that
## ends the same tween again.
static func _end(slot: int, reason: TweenEndReason) -> bool:
	var record: _RECORD = _records[slot]
	if _active[slot] == 0 or record.ending:
		return false
	record.ending = true
	if (reason == TweenEndReason.COMPLETED or reason == TweenEndReason.SKIPPED) and not record.pending:
		var session: RefCounted = _session
		_apply_end_state(record)
		# a receiver or a property write released TweenCore, which ended the tween
		if session != _session:
			return false
	_unblock(record)
	var callback: Callable = record.callback
	var waiter: _WAITER = record.waiter
	_free_slot(slot)
	if not callback.is_null():
		if callback.is_valid():
			callback.call(reason)
		else:
			LogCore.log_error(_TAG, "the object of a completion callback was destroyed; the callback is not called")
	if waiter != null:
		waiter.reason = reason
		waiter.done.emit()
	return true


## Sets the target value of every change in step order. A value tween calls its receiver with the end value.
static func _apply_end_state(record: _RECORD) -> void:
	if record.change_count == 0:
		return
	if record.is_value:
		if record.receiver.is_valid():
			_set_value(record, null, record.changes[0], record.changes[0].target)
		return
	if not is_instance_id_valid(record.target_id):
		return
	var object: Object = instance_from_id(record.target_id)
	for i: int in record.change_count:
		# a property write destroyed the target or released TweenCore
		if not is_instance_id_valid(record.target_id):
			return
		var change: _CHANGE = record.changes[i]
		# a change that did not start in this cycle starts here
		var arranged: bool = change.arranged if change.started else _is_arranged(object)
		_write(object, change.property, change.target, arranged)


static func _unblock(record: _RECORD) -> void:
	if record.block_token == 0:
		return
	if InputBlockCore.is_initialized() and InputBlockCore.is_active(record.block_token):
		InputBlockCore.unblock(record.block_token)
	record.block_token = 0


static func _stop_pending_of(target_id: int) -> void:
	var base: int = _end_top
	var slot: int = _first_of_target(target_id)
	while slot >= 0:
		var record: _RECORD = _records[slot]
		if record.pending and record.target_id == target_id:
			_push_end(record)
		slot = _target_next[slot]
	_end_pushed(base, TweenEndReason.STOPPED)


## Stops the started tweens of the target that change a property in `mask`, but the tween in `except_slot`.
static func _stop_conflicts(target_id: int, mask: int, except_slot: int) -> void:
	if mask == 0:
		return
	var base: int = _end_top
	var slot: int = _first_of_target(target_id)
	while slot >= 0:
		var record: _RECORD = _records[slot]
		if slot != except_slot and not record.pending and record.target_id == target_id and (record.mask & mask) != 0:
			_push_end(record)
		slot = _target_next[slot]
	_end_pushed(base, TweenEndReason.STOPPED)


# ogw:input_boundary
static func _end_target(operation: String, target: Variant, reason: TweenEndReason) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, operation + ": not initialized")
		return 0
	var object: Object = _object_of(target)
	if object == null:
		LogCore.log_error(_TAG, operation + ": the object is missing or destroyed")
		return 0
	var base: int = _end_top
	_push_target(object.get_instance_id())
	return _end_pushed(base, reason)


static func _end_tag(operation: String, tag: String, reason: TweenEndReason) -> int:
	if not _is_initialized:
		LogCore.log_error(_TAG, operation + ": not initialized")
		return 0
	if tag == "":
		LogCore.log_error(_TAG, operation + ": the tag is an empty string")
		return 0
	var base: int = _end_top
	for i: int in _property_count:
		var record: _RECORD = _records[_property_slots[i]]
		if record.tag == tag:
			_push_end(record)
	return _end_pushed(base, reason)


## Pool return cleaner: stops every tween whose target is `object` or under it. Returns the number of tweens of
## `object` left. PoolCore calls it for each constituent object, and most of them have no child: their tweens come
## from the target index alone.
static func _on_pool_return(object: Node) -> int:
	if not _is_initialized or not is_instance_valid(object) or _property_count == 0:
		return 0
	var object_id: int = object.get_instance_id()
	var base: int = _end_top
	if object.get_child_count(true) == 0:
		_push_target(object_id)
	else:
		for i: int in _property_count:
			var record: _RECORD = _records[_property_slots[i]]
			if record.target_id == object_id:
				_push_end(record)
				continue
			var target: Node = instance_from_id(record.target_id) as Node
			if target != null and object.is_ancestor_of(target):
				_push_end(record)
	_end_pushed(base, TweenEndReason.STOPPED)
	if not _is_initialized:
		return 0
	var left: int = 0
	var slot: int = _first_of_target(object_id)
	while slot >= 0:
		if _records[slot].target_id == object_id:
			left += 1
		slot = _target_next[slot]
	return left


## Pushes the handle of every tween of the target `target_id`.
static func _push_target(target_id: int) -> void:
	var slot: int = _first_of_target(target_id)
	while slot >= 0:
		var record: _RECORD = _records[slot]
		if record.target_id == target_id:
			_push_end(record)
		slot = _target_next[slot]


static func _push_end(record: _RECORD) -> void:
	if _end_top == _end_handles.size():
		_end_handles.resize(maxi(_end_handles.size() * 2, _INITIAL_SLOTS))
	_end_handles[_end_top] = record.handle
	_end_top += 1


## Ends the tweens of the handles pushed from `base`. A tween started by a callback meanwhile has another handle, so it
## goes on. Returns the number ended.
static func _end_pushed(base: int, reason: TweenEndReason) -> int:
	var top: int = _end_top
	var session: RefCounted = _session
	var ended: int = 0
	for i: int in range(base, top):
		var slot: int = _slot_of(_end_handles[i])
		if slot >= 0 and _end(slot, reason):
			ended += 1
		# a callback released TweenCore
		if session != _session:
			return ended
	_end_top = base
	return ended


# --- definition ---


## The first failed definition check item of `definition` on `object`, or an empty string when it passes.
static func _check_failure(definition: TweenDefinition, object: Object) -> String:
	if definition.repeat_count < 0 or definition.repeat_count > _max_repeat_count:
		return "repeat count %d is below 0 or above TweenCore.maxRepeatCount" % definition.repeat_count
	var cycle_ms: int = 0
	for s: int in definition.steps.size():
		var step: TweenStep = definition.steps[s]
		if step == null or step.changes.is_empty():
			return "step %d has no change" % s
		var step_mask: int = 0
		var longest: int = 0
		for c: int in step.changes.size():
			var change: TweenChange = step.changes[c]
			if change == null:
				return "change %d of step %d is missing" % [c, s]
			if not _is_property(change.property) or not _is_easing(change.easing):
				return "change %d of step %d has a property or easing that is not a member" % [c, s]
			if change.duration < 0 or change.duration > _max_duration_ms:
				return "change %d of step %d has duration %d ms out of range" % [c, s, change.duration]
			if change.delay < 0 or change.delay > _max_duration_ms:
				return "change %d of step %d has delay %d ms out of range" % [c, s, change.delay]
			if not _has_property(object, change.property):
				return "the target object has no property of change %d of step %d" % [c, s]
			if not _values_in_range(change, object):
				return "change %d of step %d has a value that is not finite or out of range" % [c, s]
			if not _unused_components_are_zero(change, object):
				return "change %d of step %d has a value whose components the property does not use are not 0" % [c, s]
			var mask: int = _mask_of(change.property)
			if (step_mask & mask) != 0:
				return "step %d changes one property twice" % s
			step_mask |= mask
			longest = maxi(longest, change.delay + change.duration)
		cycle_ms += longest
	if definition.repeat_count == 0 and cycle_ms <= 0:
		return "the definition repeats forever with cycle time 0"
	return ""


static func _values_in_range(change: TweenChange, object: Object) -> bool:
	var used: int = _property_components(change.property, object is Node3D)
	if not _is_finite_vector(change.target_value, used):
		return false
	if not _is_finite_vector(change.start_value, used):
		return false
	if change.property == TweenProperty.COLOR or change.property == TweenProperty.OPACITY:
		if not _is_unit_vector(change.target_value, used):
			return false
		if not _is_unit_vector(change.start_value, used):
			return false
	return true


## Whether the target value and the start value are 0 in the components the property does not use on `object`.
static func _unused_components_are_zero(change: TweenChange, object: Object) -> bool:
	var used: int = _property_components(change.property, object is Node3D)
	for i: int in range(used, 4):
		if change.target_value[i] != 0.0:
			return false
		if change.start_value[i] != 0.0:
			return false
	return true


## Number of the 4 vector components the property uses.
static func _property_components(property: int, is_3d: bool) -> int:
	match property:
		TweenProperty.POSITION, TweenProperty.SCALE:
			return 3 if is_3d else 2
		TweenProperty.ROTATION:
			return 3 if is_3d else 1
		TweenProperty.COLOR:
			return 4
	return 1


static func _value_components(kind: int) -> int:
	match kind:
		TweenValueKind.VECTOR2:
			return 2
		TweenValueKind.COLOR:
			return 4
	return 1


static func _is_finite_vector(value: Vector4, used: int) -> bool:
	for i: int in used:
		if not is_finite(value[i]):
			return false
	return true


static func _is_unit_vector(value: Vector4, used: int) -> bool:
	for i: int in used:
		if value[i] < 0.0 or value[i] > 1.0:
			return false
	return true


static func _first_change(definition: TweenDefinition) -> TweenChange:
	if definition == null or definition.steps.is_empty():
		return null
	var step: TweenStep = definition.steps[0]
	if step == null or step.changes.is_empty():
		return null
	return step.changes[0]


static func _mask_of_definition(definition: TweenDefinition) -> int:
	if definition == null:
		return 0
	var mask: int = 0
	for step: TweenStep in definition.steps:
		for change: TweenChange in step.changes:
			mask |= _mask_of(change.property)
	return mask


static func _mask_of(property: int) -> int:
	match property:
		TweenProperty.POSITION:
			return _MASK_POSITION
		TweenProperty.ROTATION:
			return _MASK_ROTATION
		TweenProperty.SCALE:
			return _MASK_SCALE
	return _MASK_COLOR


static func _copy_changes(source: TweenStep, copy: TweenStep) -> void:
	if is_same(copy.changes, source.changes):
		var changes: Array[TweenChange] = []
		copy.changes = changes
	var count: int = source.changes.size()
	copy.changes.resize(count)
	for c: int in count:
		var source_change: TweenChange = source.changes[c]
		if source_change == null:
			copy.changes[c] = null
			continue
		var change: TweenChange = copy.changes[c]
		if change == null or source.changes.has(change):
			change = TweenChange.new()
			copy.changes[c] = change
		change.property = source_change.property
		change.target_value = source_change.target_value
		change.use_start_value = source_change.use_start_value
		change.start_value = source_change.start_value
		change.duration = source_change.duration
		change.delay = source_change.delay
		change.easing = source_change.easing


# --- target properties ---


static func _has_property(object: Object, property: int) -> bool:
	if property == TweenProperty.COLOR or property == TweenProperty.OPACITY:
		return object is CanvasItem or object is SpriteBase3D or object is Label3D
	return object is Node2D or object is Control or object is Node3D


## Whether `object` is an arranged element: a `Control` whose parent is a `Container`.
static func _is_arranged(object: Object) -> bool:
	return object is Control and (object as Control).get_parent() is Container


## The property value of `object` as a 4 component vector. Unused components are 0. `Position`, `Rotation` and
## `Scale` of an arranged element are its offset transform.
static func _read(object: Object, property: int, arranged: bool) -> Vector4:
	if arranged and property <= TweenProperty.SCALE:
		var control: Control = object as Control
		match property:
			TweenProperty.POSITION:
				var p: Vector2 = control.offset_transform_position
				return Vector4(p.x, p.y, 0.0, 0.0)
			TweenProperty.ROTATION:
				return Vector4(rad_to_deg(control.offset_transform_rotation), 0.0, 0.0, 0.0)
		var s: Vector2 = control.offset_transform_scale
		return Vector4(s.x, s.y, 0.0, 0.0)
	match property:
		TweenProperty.POSITION:
			if object is Node3D:
				var p3: Vector3 = (object as Node3D).position
				return Vector4(p3.x, p3.y, p3.z, 0.0)
			var p2: Vector2 = (object as Node2D).position if object is Node2D else (object as Control).position
			return Vector4(p2.x, p2.y, 0.0, 0.0)
		TweenProperty.ROTATION:
			if object is Node3D:
				var r3: Vector3 = (object as Node3D).rotation_degrees
				return Vector4(r3.x, r3.y, r3.z, 0.0)
			var r2: float = (
				(object as Node2D).rotation_degrees if object is Node2D else (object as Control).rotation_degrees
			)
			return Vector4(r2, 0.0, 0.0, 0.0)
		TweenProperty.SCALE:
			if object is Node3D:
				var s3: Vector3 = (object as Node3D).scale
				return Vector4(s3.x, s3.y, s3.z, 0.0)
			var s2: Vector2 = (object as Node2D).scale if object is Node2D else (object as Control).scale
			return Vector4(s2.x, s2.y, 0.0, 0.0)
		TweenProperty.COLOR:
			var color: Color = _modulate_of(object)
			return Vector4(color.r, color.g, color.b, color.a)
	return Vector4(_modulate_of(object).a, 0.0, 0.0, 0.0)


## Sets the property value of `object`. `Color` and `Opacity` are clamped to 0..1. `Position`, `Rotation` and
## `Scale` of an arranged element go to its offset transform.
static func _write(object: Object, property: int, value: Vector4, arranged: bool) -> void:
	if arranged and property <= TweenProperty.SCALE:
		_write_offset(object as Control, property, value)
		return
	match property:
		TweenProperty.POSITION:
			if object is Node3D:
				(object as Node3D).position = Vector3(value.x, value.y, value.z)
			elif object is Node2D:
				(object as Node2D).position = Vector2(value.x, value.y)
			elif object is Control:
				(object as Control).position = Vector2(value.x, value.y)
		TweenProperty.ROTATION:
			if object is Node3D:
				(object as Node3D).rotation_degrees = Vector3(value.x, value.y, value.z)
			elif object is Node2D:
				(object as Node2D).rotation_degrees = value.x
			elif object is Control:
				(object as Control).rotation_degrees = value.x
		TweenProperty.SCALE:
			if object is Node3D:
				(object as Node3D).scale = Vector3(value.x, value.y, value.z)
			elif object is Node2D:
				(object as Node2D).scale = Vector2(value.x, value.y)
			elif object is Control:
				(object as Control).scale = Vector2(value.x, value.y)
		TweenProperty.COLOR:
			_set_modulate(
				object,
				Color(clampf(value.x, 0.0, 1.0), clampf(value.y, 0.0, 1.0), clampf(value.z, 0.0, 1.0),
						clampf(value.w, 0.0, 1.0))
			)
		TweenProperty.OPACITY:
			var color: Color = _modulate_of(object)
			color.a = clampf(value.x, 0.0, 1.0)
			_set_modulate(object, color)


## Sets the offset transform of an arranged element, about the pivot of a `Control` that is not arranged.
static func _write_offset(control: Control, property: int, value: Vector4) -> void:
	control.offset_transform_enabled = true
	control.offset_transform_visual_only = false
	control.offset_transform_pivot = control.pivot_offset
	control.offset_transform_pivot_ratio = control.pivot_offset_ratio
	match property:
		TweenProperty.POSITION:
			control.offset_transform_position = Vector2(value.x, value.y)
		TweenProperty.ROTATION:
			control.offset_transform_rotation = deg_to_rad(value.x)
		TweenProperty.SCALE:
			control.offset_transform_scale = Vector2(value.x, value.y)


static func _modulate_of(object: Object) -> Color:
	if object is CanvasItem:
		return (object as CanvasItem).modulate
	if object is SpriteBase3D:
		return (object as SpriteBase3D).modulate
	if object is Label3D:
		return (object as Label3D).modulate
	return Color.WHITE


static func _set_modulate(object: Object, color: Color) -> void:
	if object is CanvasItem:
		(object as CanvasItem).modulate = color
	elif object is SpriteBase3D:
		(object as SpriteBase3D).modulate = color
	elif object is Label3D:
		(object as Label3D).modulate = color


# --- easing ---


## Robert Penner easing of `easing` at progress `t`, clamped to 0..1. Progress 0 is 0 and 1 is 1.
static func _ease(easing: int, t: float) -> float:
	if t <= 0.0:
		return 0.0
	if t >= 1.0:
		return 1.0
	match easing:
		Easing.QUAD_IN:
			return t * t
		Easing.QUAD_OUT:
			return 1.0 - (1.0 - t) * (1.0 - t)
		Easing.QUAD_IN_OUT:
			return 2.0 * t * t if t < 0.5 else 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0
		Easing.CUBIC_IN:
			return t * t * t
		Easing.CUBIC_OUT:
			return 1.0 - pow(1.0 - t, 3.0)
		Easing.CUBIC_IN_OUT:
			return 4.0 * t * t * t if t < 0.5 else 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0
		Easing.SINE_IN:
			return 1.0 - cos(t * PI / 2.0)
		Easing.SINE_OUT:
			return sin(t * PI / 2.0)
		Easing.SINE_IN_OUT:
			return -(cos(PI * t) - 1.0) / 2.0
		Easing.BACK_IN:
			return _BACK_C3 * t * t * t - _BACK_C1 * t * t
		Easing.BACK_OUT:
			return 1.0 + _BACK_C3 * pow(t - 1.0, 3.0) + _BACK_C1 * pow(t - 1.0, 2.0)
		Easing.BACK_IN_OUT:
			if t < 0.5:
				return pow(2.0 * t, 2.0) * ((_BACK_C2 + 1.0) * 2.0 * t - _BACK_C2) / 2.0
			return (pow(2.0 * t - 2.0, 2.0) * ((_BACK_C2 + 1.0) * (t * 2.0 - 2.0) + _BACK_C2) + 2.0) / 2.0
		Easing.ELASTIC_OUT:
			return pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * _ELASTIC_C4) + 1.0
		Easing.BOUNCE_OUT:
			return _bounce_out(t)
	return t


static func _bounce_out(t: float) -> float:
	if t < 1.0 / _BOUNCE_D1:
		return _BOUNCE_N1 * t * t
	if t < 2.0 / _BOUNCE_D1:
		var a: float = t - 1.5 / _BOUNCE_D1
		return _BOUNCE_N1 * a * a + 0.75
	if t < 2.5 / _BOUNCE_D1:
		var b: float = t - 2.25 / _BOUNCE_D1
		return _BOUNCE_N1 * b * b + 0.9375
	var c: float = t - 2.625 / _BOUNCE_D1
	return _BOUNCE_N1 * c * c + 0.984375


# --- members ---


static func _is_property(value: int) -> bool:
	return value >= 0 and value < TweenProperty.size()


static func _is_easing(value: int) -> bool:
	return value >= 0 and value < Easing.size()


static func _is_time_basis(value: int) -> bool:
	return value >= 0 and value < TimeBasis.size()


static func _now(time_basis: int) -> int:
	if time_basis == TimeBasis.GAME_TIME:
		return TimeCore.get_game_time()
	return TimeCore.get_real_time()


# ogw:input_boundary
static func _object_of(value: Variant) -> Object:
	if typeof(value) != TYPE_OBJECT or not is_instance_valid(value):
		return null
	var object: Object = value
	return object


# --- slots ---


static func _take_slot() -> int:
	if _free_count == 0:
		if _slot_count >= _MAX_SLOTS:
			return -1
		_grow(mini(_slot_count * 2, _MAX_SLOTS))
		if _free_count == 0:
			return -1
	_free_count -= 1
	var slot: int = _free_slots[_free_count]
	_active[slot] = 1
	_active_count += 1
	_records[slot].handle = _generation[slot] << _SLOT_BITS | slot
	return slot


static func _free_slot(slot: int) -> void:
	if _active[slot] == 0:
		return
	_unlink_target(slot)
	_active[slot] = 0
	_active_count -= 1
	_records[slot].reset()
	# a slot whose generation ran out is not used again, so no handle value comes back
	if _generation[slot] >= _MAX_GENERATION:
		return
	_generation[slot] += 1
	_free_slots[_free_count] = slot
	_free_count += 1


static func _slot_of(handle: int) -> int:
	if handle <= 0:
		return -1
	var slot: int = handle & _SLOT_MASK
	if slot >= _slot_count or _active[slot] == 0 or _generation[slot] != handle >> _SLOT_BITS:
		return -1
	return slot


## Grows the slots to `count`, a power of two, and rebuilds the target index with `count` buckets.
static func _grow(count: int) -> void:
	var old: int = _slot_count
	if count <= old:
		return
	_generation.resize(count)
	_active.resize(count)
	_records.resize(count)
	_free_slots.resize(count)
	_bucket_first.resize(count)
	_target_next.resize(count)
	_target_prev.resize(count)
	_property_slots.resize(count)
	_property_index.resize(count)
	# the lowest new slot is taken first
	for slot: int in range(count - 1, old - 1, -1):
		_generation[slot] = 1
		_active[slot] = 0
		_records[slot] = _RECORD.new()
		_property_index[slot] = -1
		_free_slots[_free_count] = slot
		_free_count += 1
	_slot_count = count
	_bucket_first.fill(-1)
	for i: int in _property_count:
		_insert_bucket(_property_slots[i])


## The bucket of the target `target_id`. Instance IDs keep the object slot in their low bits.
static func _bucket_of(target_id: int) -> int:
	return (target_id ^ (target_id >> _SLOT_BITS)) & (_slot_count - 1)


## The first slot in the bucket of the target `target_id`, or -1. The bucket also holds the tweens of other targets.
static func _first_of_target(target_id: int) -> int:
	if _slot_count == 0:
		return -1
	return _bucket_first[_bucket_of(target_id)]


## Adds the property tween in `slot` to the target index.
static func _link_target(slot: int) -> void:
	_insert_bucket(slot)
	_property_index[slot] = _property_count
	_property_slots[_property_count] = slot
	_property_count += 1


static func _insert_bucket(slot: int) -> void:
	var bucket: int = _bucket_of(_records[slot].target_id)
	var first: int = _bucket_first[bucket]
	_target_prev[slot] = -1
	_target_next[slot] = first
	if first >= 0:
		_target_prev[first] = slot
	_bucket_first[bucket] = slot


## Removes the tween in `slot` from the target index when it is there.
static func _unlink_target(slot: int) -> void:
	var index: int = _property_index[slot]
	if index < 0:
		return
	var prev: int = _target_prev[slot]
	var next: int = _target_next[slot]
	if prev >= 0:
		_target_next[prev] = next
	else:
		_bucket_first[_bucket_of(_records[slot].target_id)] = next
	if next >= 0:
		_target_prev[next] = prev
	_property_count -= 1
	var last: int = _property_slots[_property_count]
	_property_slots[index] = last
	_property_index[last] = index
	_property_index[slot] = -1


# --- lifecycle ---


static func _on_node_exit(node: Node) -> void:
	if node != _node or not _is_initialized:
		return
	_node = null
	_end_state()


## Ends every tween without callback, lifts the input blocks, resets the state, then ends the `wait_end` calls with
## `None`. Property values stay as they are.
static func _end_state() -> void:
	var waiters: Array[_WAITER] = []
	for slot: int in _slot_count:
		if _active[slot] == 0:
			continue
		var record: _RECORD = _records[slot]
		_unblock(record)
		if record.waiter != null:
			waiters.append(record.waiter)
		# a frame or end processing that called the code releasing TweenCore sees its tween gone
		record.reset()
	_is_initialized = false
	_session = null
	_max_duration_ms = 0
	_max_repeat_count = 0
	_preset_kind = _INVALID_KIND
	_default_options = null
	_flush = Callable()
	_load_preset_call = Callable()
	_flush_queued = false
	_flush_session = null
	_slot_count = 0
	_generation = PackedInt64Array()
	_active = PackedByteArray()
	_records = []
	_free_slots = PackedInt32Array()
	_free_count = 0
	_active_count = 0
	_bucket_first = PackedInt32Array()
	_target_next = PackedInt32Array()
	_target_prev = PackedInt32Array()
	_property_slots = PackedInt32Array()
	_property_index = PackedInt32Array()
	_property_count = 0
	_end_handles = PackedInt64Array()
	_end_top = 0
	for waiter: _WAITER in waiters:
		waiter.reason = TweenEndReason.NONE
		waiter.done.emit()
