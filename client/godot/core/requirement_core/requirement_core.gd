class_name RequirementCore
extends RefCounted
## Judges the conditions of the `requirement` table with UserState and data, and calls the watch callbacks when the
## result of a watched condition changes. The server judges the same table with the same rules again.

enum TriggerKind { USER_STATE_CHANGED, REQUEST_COMPLETED, UI_OPENED, UI_CLOSED, CONTENT_EVENT }

const _TAG: String = "RequirementCore"
const _MAX_ROUNDS_KEY: String = "RequirementCore.maxBatchRounds"
const _RECHECK_KEY: String = "RequirementCore.timeRecheckMs"
const _REACH_MARGIN_KEY: String = "TimeCore.reachMarginMs"
const _SETTINGS_KEYS: PackedStringArray = [_MAX_ROUNDS_KEY, _RECHECK_KEY, _REACH_MARGIN_KEY]
const _CORE_NODE := preload("res://core/requirement_core/requirement_core_node.gd")
const _JUDGE := preload("res://core/requirement_core/requirement_judge.gd")
const _ENTRY := preload("res://core/requirement_core/requirement_entry.gd")
const _WATCH := preload("res://core/requirement_core/requirement_watch.gd")
## The core node processes after `TimeCore` and before the content nodes, so the batch evaluation of a frame comes
## before the content update of that frame.
const _PROCESS_PRIORITY: int = -1000
## Number of `TriggerKind` members.
const _TRIGGER_KINDS: int = 5

# The pending buffer a watch is in.
const _QUEUE_NONE: int = 0
const _QUEUE_PENDING: int = 1
const _QUEUE_ROUND: int = 2

# Status of a judgement.
const _PASS: int = 0
const _FAIL: int = 1
## A judge hook failed or gave an output that is not a bool.
const _ERROR: int = 2

static var _is_initialized: bool = false
## Replaced by every `init`; a batch evaluation that sees another session after a callback stops.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null

# Settings read in `init`.
static var _max_rounds: int = 0
static var _recheck_ms: int = 0

## Registered judges by `RequirementType` value.
static var _judges: Dictionary[int, _JUDGE] = {}
## Entries of the conditions judged since `init`, by requirement ID value, and the same entries in a list.
static var _entries: Dictionary[int, _ENTRY] = {}
static var _entry_list: Array[_ENTRY] = []
## Requirement IDs whose entry is being made, to stop at a sub-condition that comes back to its condition.
static var _building: Dictionary[int, bool] = {}
## The result of requirement ID 0.
static var _zero: RequirementResult = RequirementResult.new()

## Watch slots. A removed watch leaves `null`, which a later `watch` reuses. The buffers below that hold slots or
## watches grow only in `watch`, so a removal in frame code changes no collection size.
static var _watches: Array[_WATCH] = []
## The `null` slots of `_watches`: the first `_free_count` entries. As long as `_watches`.
static var _free_slots: PackedInt32Array = PackedInt32Array()
static var _free_count: int = 0
## Pending evaluations for the next round: the first `_pending_count` entries. The watches of the running round not
## judged yet: the first `_round_count` entries of `_round`. Both as long as `_watches`; a watch is in at most one.
static var _pending: Array[_WATCH] = []
static var _pending_count: int = 0
static var _round: Array[_WATCH] = []
static var _round_count: int = 0
## The slots of the watches that have an owner object, which the frame code checks for destroyed owners. Only the
## first `_owner_count` entries are in use.
static var _owner_slots: PackedInt32Array = PackedInt32Array()
static var _owner_count: int = 0
## Link pool of the lists of watch slots. A list is a ring that starts at its head link; `_link_slot` is the watch
## slot of a link (-1 for a head link). Unused links are chained through `_link_next` from `_free_link`. The pool
## grows only outside frame code.
static var _link_next: PackedInt32Array = PackedInt32Array()
static var _link_prev: PackedInt32Array = PackedInt32Array()
static var _link_slot: PackedInt32Array = PackedInt32Array()
static var _free_link: int = -1
## Head links of the lists: the watches of each requirement ID value; the watches each UserState kind marks; the
## watches of each target name of `REQUEST_COMPLETED`, `UI_OPENED` and `UI_CLOSED` triggers; the watches of each
## content event type; the watches of time-dependent conditions. A head stays until `release`.
static var _id_heads: Dictionary[int, int] = {}
static var _state_heads: Dictionary[GDScript, int] = {}
static var _request_heads: Dictionary[String, int] = {}
static var _opened_heads: Dictionary[String, int] = {}
static var _closed_heads: Dictionary[String, int] = {}
static var _content_heads: Dictionary[Script, int] = {}
static var _time_head: int = -1
## Watches of time-dependent conditions, and the real elapsed time of the next time recheck.
static var _time_watch_count: int = 0
static var _recheck_at: int = 0
## Watches that subscribe through a trigger, by `TriggerKind` (`CONTENT_EVENT` unused), and by content event type.
static var _kind_counts: PackedInt32Array = PackedInt32Array([0, 0, 0, 0, 0])
static var _content_counts: Dictionary[Script, int] = {}

## Requirement IDs that already left their error log.
static var _logged_ids: Dictionary[int, bool] = {}
## Whether each `RequirementType` value already left its no-judge-hook error log. `init` puts every value with
## `false`, so the frame code only changes values and adds no key.
static var _logged_types: Dictionary[int, bool] = {}


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	for key: String in _SETTINGS_KEYS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init: settings key %s is missing or not an integer" % key)
			return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init: the main loop is not a SceneTree")
		return false
	_max_rounds = CoreSettings.get_int(_MAX_ROUNDS_KEY)
	_recheck_ms = CoreSettings.get_int(_RECHECK_KEY)
	for type: int in GameData.RequirementType.values():
		_logged_types[type] = false
	_time_head = _new_link(-1)
	_session = RefCounted.new()
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	node.process_priority = _PROCESS_PRIORITY
	_node = node
	_is_initialized = true
	tree.root.add_child(node)
	if not EventCore.subscribe(DayChangedEvent, node.on_day_changed):
		LogCore.log_error(_TAG, "init: could not subscribe to DayChangedEvent")
		release()
		return false
	return true


static func release() -> void:
	var node: _CORE_NODE = _node
	if node != null and is_instance_valid(node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	_node = null
	_reset()
	if node != null and is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Registers the judge hook of `type`: a static func that takes a `GameData.RequirementRow` and returns a pass flag.
## `kinds` are the UserState kind classes it reads, `guide_key` the guide text translation key, `guide_args` an
## optional static func that takes the row and a `FormatArgs` and puts the guide arguments into it.
static func register_judge(type: GameData.RequirementType, judge: Callable, kinds: Array[GDScript], guide_key: String, guide_args: Callable = Callable(), time_dependent: bool = false) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "register_judge: not initialized")
		return false
	if type == GameData.RequirementType.NONE or not GameData.RequirementType.values().has(type):
		LogCore.log_error(_TAG, "register_judge: type %d is None or not a RequirementType element" % type)
		return false
	if _judges.has(type):
		LogCore.log_error(_TAG, "register_judge: type %d has a judge hook already; the later one is ignored" % type)
		return false
	if not _is_static(judge):
		LogCore.log_error(_TAG, "register_judge: the judge hook of type %d is not a static func" % type)
		return false
	if not guide_args.is_null() and not _is_static(guide_args):
		LogCore.log_error(_TAG, "register_judge: the guide argument hook of type %d is not a static func" % type)
		return false
	var record: _JUDGE = _JUDGE.new()
	record.judge = judge
	for kind: GDScript in kinds:
		if kind != null and not record.kinds.has(kind):
			record.kinds.append(kind)
	record.guide_key = guide_key
	record.guide_args = guide_args
	record.time_dependent = time_dependent
	_judges[type] = record
	for entry: _ENTRY in _entry_list:
		if entry.types.has(type):
			entry.valid = false
			_refresh_kinds(entry)
	_relink_watches()
	return true


## The result of the condition `requirement_id`. The object is the value the module keeps for the condition.
static func evaluate(requirement_id: int) -> RequirementResult:
	if not _is_initialized:
		LogCore.log_error(_TAG, "evaluate: not initialized")
		return _failure(requirement_id)
	if requirement_id == 0:
		_zero.passed = true
		_zero.failed_requirement_id = 0
		_zero.guide_key = ""
		return _zero
	var entry: _ENTRY = _entry_of(requirement_id)
	if entry == null:
		if not _logged_ids.has(requirement_id):
			_logged_ids[requirement_id] = true
			LogCore.log_error(_TAG, "evaluate: requirement %d is not in the requirement table" % requirement_id)
		return _failure(requirement_id)
	return _evaluate_entry(entry)


## Watches the condition `requirement_id`: when one of `triggers` is raised the condition is judged again in the batch
## evaluation, and `callback(requirement_id, result)` is called when `passed` or `failed_requirement_id` changed. A
## watch with `owner` is removed without a log when that object is destroyed.
# ogw:input_boundary
static func watch(requirement_id: int, triggers: Array[RequirementTrigger], callback: Callable, owner: Variant = null) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "watch: not initialized")
		return false
	var owner_id: int = 0
	if typeof(owner) != TYPE_NIL:
		if typeof(owner) != TYPE_OBJECT or not is_instance_valid(owner):
			LogCore.log_error(_TAG, "watch: the owner object of requirement %d is destroyed" % requirement_id)
			return false
		var object: Object = owner
		owner_id = object.get_instance_id()
	if requirement_id == 0:
		LogCore.log_error(_TAG, "watch: requirement 0 is no condition")
		return false
	if not GameData.RequirementTable.has_row(requirement_id):
		LogCore.log_error(_TAG, "watch: requirement %d is not in the requirement table" % requirement_id)
		return false
	if triggers.is_empty():
		LogCore.log_error(_TAG, "watch: the trigger list of requirement %d is empty" % requirement_id)
		return false
	if not callback.is_valid():
		LogCore.log_error(_TAG, "watch: the callback of requirement %d cannot be called" % requirement_id)
		return false
	if _find_watch(requirement_id, callback) >= 0:
		LogCore.log_error(_TAG, "watch: requirement %d has a watch with the same callback" % requirement_id)
		return false
	for trigger: RequirementTrigger in triggers:
		if not _is_valid_trigger(trigger):
			LogCore.log_error(_TAG, "watch: a trigger of requirement %d has no valid kind and target" % requirement_id)
			return false
	var entry: _ENTRY = _entry_of(requirement_id)
	if entry == null:
		LogCore.log_error(_TAG, "watch: requirement %d has no condition entry" % requirement_id)
		return false
	var record: _WATCH = _WATCH.new()
	record.requirement_id = requirement_id
	record.entry = entry
	record.callback = callback
	record.owner_id = owner_id
	for trigger: RequirementTrigger in triggers:
		var copy: RequirementTrigger = RequirementTrigger.new()
		copy.kind = trigger.kind
		copy.user_state_kind = trigger.user_state_kind
		copy.target_name = trigger.target_name
		copy.event_type = trigger.event_type
		record.triggers.append(copy)
		if trigger.kind == TriggerKind.CONTENT_EVENT:
			if not record.event_types.has(trigger.event_type):
				record.event_types.append(trigger.event_type)
		else:
			record.kinds_mask |= 1 << trigger.kind
	if not _subscribe_watch(record):
		LogCore.log_error(_TAG, "watch: could not subscribe to the trigger events of requirement %d" % requirement_id)
		return false
	var result: RequirementResult = _evaluate_entry(entry)
	record.base_passed = result.passed
	record.base_failed_id = result.failed_requirement_id
	_store_watch(record)
	return true


## Removes the watch of `requirement_id` whose callback is `callback`. Does nothing when there is none.
static func unwatch(requirement_id: int, callback: Callable) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "unwatch: not initialized")
		return
	var slot: int = _find_watch(requirement_id, callback)
	if slot >= 0:
		_remove_watch_at(slot)


## Clears `args`, then puts the guide arguments of the first failed condition of `result` into it with the guide
## argument hook of its type. Leaves `args` empty for a passed result.
static func fill_guide_args(result: RequirementResult, args: FormatArgs) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "fill_guide_args: not initialized")
		return
	if args == null:
		LogCore.log_error(_TAG, "fill_guide_args: no FormatArgs")
		return
	args.clear()
	if result == null:
		LogCore.log_error(_TAG, "fill_guide_args: no RequirementResult")
		return
	if result.passed or not GameData.RequirementTable.has_row(result.failed_requirement_id):
		return
	var row: GameData.RequirementRow = GameData.RequirementTable.get_row(result.failed_requirement_id)
	if not _judges.has(row.type):
		return
	var hook: Callable = _judges[row.type].guide_args
	if hook.is_null():
		return
	var mark: int = CoreScriptErrors.begin()
	hook.call(row, args)
	if CoreScriptErrors.end(mark):
		args.clear()
		LogCore.log_error(_TAG, "the guide argument hook of RequirementType %d threw for requirement %d" % [row.type, row.id])


# --- judgement ---


## Judges `entry` and returns the result the module keeps for it: a failure value when a judge hook failed.
static func _evaluate_entry(entry: _ENTRY) -> RequirementResult:
	if _judge(entry) == _ERROR:
		entry.result.passed = false
		entry.result.failed_requirement_id = entry.row.id
		entry.result.guide_key = ""
	return entry.result


## Judges `entry` with its cache and the cache of its sub-conditions, and puts the result into `entry.result`.
static func _judge(entry: _ENTRY) -> int:
	if _is_cache_valid(entry):
		return _PASS if entry.result.passed else _FAIL
	var row: GameData.RequirementRow = entry.row
	var has_self: bool = row.type != GameData.RequirementType.NONE
	var passed: bool = true
	var failed_id: int = 0
	var guide: String = ""
	if row.logic == GameData.RequirementLogic.ALL or row.logic == GameData.RequirementLogic.ANY:
		var is_any: bool = row.logic == GameData.RequirementLogic.ANY
		var first_child: int = 1 if has_self else 0
		var item_count: int = first_child + entry.children.size()
		passed = not is_any
		if is_any and item_count == 0:
			failed_id = row.id
		for index: int in item_count:
			var item_status: int = _PASS
			var item_failed_id: int = row.id
			var item_guide: String = ""
			if index < first_child:
				item_status = _self_judge(entry)
				item_guide = _guide_of(row.type)
			else:
				var child: _ENTRY = entry.children[index - first_child] as _ENTRY
				item_status = _judge(child)
				item_failed_id = child.result.failed_requirement_id
				item_guide = child.result.guide_key
			if item_status == _ERROR:
				entry.valid = false
				return _ERROR
			if is_any:
				if item_status == _PASS:
					passed = true
					break
				if index == 0:
					failed_id = item_failed_id
					guide = item_guide
			elif item_status == _FAIL:
				passed = false
				failed_id = item_failed_id
				guide = item_guide
				break
	elif has_self:
		var status: int = _self_judge(entry)
		if status == _ERROR:
			entry.valid = false
			return _ERROR
		passed = status == _PASS
		failed_id = row.id
		guide = _guide_of(row.type)
	entry.result.passed = passed
	entry.result.failed_requirement_id = 0 if passed else failed_id
	entry.result.guide_key = "" if passed else guide
	if entry.time_dependent:
		entry.valid = false
	else:
		entry.valid = true
		for i: int in entry.kinds.size():
			entry.change_numbers[i] = UserStateCore.get_change_number(entry.kinds[i])
	return _PASS if passed else _FAIL


## The self judgement of `entry` with the judge hook of its type.
static func _self_judge(entry: _ENTRY) -> int:
	var type: int = entry.row.type
	if not _judges.has(type):
		if not _logged_types.get(type, false):
			# A value that is not a `RequirementType` element is not added, so it logs on every judgement.
			if _logged_types.has(type):
				_logged_types[type] = true
			LogCore.log_error(_TAG, "no judge hook for RequirementType %d; its self judgement fails" % type)
		return _FAIL
	var output: int = _call_judge(_judges[type].judge, entry.row)
	if output < 0:
		LogCore.log_error(_TAG, "the judge hook of RequirementType %d threw or did not return a bool for requirement %d" % [type, entry.row.id])
		return _ERROR
	return _PASS if output == 1 else _FAIL


## 1 when the judge hook returned `true`, 0 for `false`, −1 when it threw (a GDScript runtime error during the call)
## or returned anything else.
# ogw:input_boundary
static func _call_judge(judge: Callable, row: GameData.RequirementRow) -> int:
	var mark: int = CoreScriptErrors.begin()
	var output: Variant = judge.call(row)
	if CoreScriptErrors.end(mark) or not output is bool:
		return -1
	return 1 if output == true else 0


static func _guide_of(type: int) -> String:
	if not _judges.has(type):
		return ""
	return _judges[type].guide_key


## True when the result of `entry` is a cache: judged, not time-dependent, and no kind it sees changed since.
static func _is_cache_valid(entry: _ENTRY) -> bool:
	if not entry.valid or entry.time_dependent:
		return false
	for i: int in entry.kinds.size():
		if UserStateCore.get_change_number(entry.kinds[i]) != entry.change_numbers[i]:
			entry.valid = false
			return false
	return true


static func _failure(requirement_id: int) -> RequirementResult:
	var result: RequirementResult = RequirementResult.new()
	result.passed = false
	result.failed_requirement_id = requirement_id
	result.guide_key = ""
	return result


## The entry of `requirement_id`, made with the entries of its sub-conditions on first use. Null when the row is not in
## the requirement table.
static func _entry_of(requirement_id: int) -> _ENTRY:
	if _entries.has(requirement_id):
		return _entries[requirement_id]
	if not GameData.RequirementTable.has_row(requirement_id):
		return null
	if _building.has(requirement_id):
		LogCore.log_error(_TAG, "the sub-conditions of requirement %d come back to it" % requirement_id)
		return null
	_building[requirement_id] = true
	var entry: _ENTRY = _ENTRY.new()
	entry.row = GameData.RequirementTable.get_row(requirement_id)
	if entry.row.type != GameData.RequirementType.NONE:
		entry.types.append(entry.row.type)
	for child_id: int in entry.row.children:
		var child: _ENTRY = _entry_of(child_id)
		if child == null:
			LogCore.log_error(_TAG, "requirement %d has a sub-condition %d that is not in the requirement table" % [requirement_id, child_id])
			continue
		entry.children.append(child)
		for type: int in child.types:
			if not entry.types.has(type):
				entry.types.append(type)
	_building.erase(requirement_id)
	_refresh_kinds(entry)
	_entries[requirement_id] = entry
	_entry_list.append(entry)
	return entry


## Sets the kinds `entry` sees and whether it is time-dependent from the judges of its types.
static func _refresh_kinds(entry: _ENTRY) -> void:
	entry.kinds.clear()
	entry.time_dependent = false
	for type: int in entry.types:
		if not _judges.has(type):
			continue
		var record: _JUDGE = _judges[type]
		if record.time_dependent:
			entry.time_dependent = true
		for kind: GDScript in record.kinds:
			if not entry.kinds.has(kind):
				entry.kinds.append(kind)
	entry.change_numbers.resize(entry.kinds.size())


static func _is_static(hook: Callable) -> bool:
	return hook.is_valid() and hook.is_standard() and hook.get_object() is Script


# --- watch ---


static func _is_valid_trigger(trigger: RequirementTrigger) -> bool:
	if trigger == null:
		return false
	match trigger.kind:
		TriggerKind.USER_STATE_CHANGED:
			return true
		TriggerKind.REQUEST_COMPLETED, TriggerKind.UI_OPENED, TriggerKind.UI_CLOSED:
			return not trigger.target_name.is_empty()
		TriggerKind.CONTENT_EVENT:
			return _is_event_type(trigger.event_type)
	return false


## True for a script that extends `EventBase`, `EventBase` itself excluded.
static func _is_event_type(type: Script) -> bool:
	if type == null:
		return false
	var base: Script = type.get_base_script()
	while base != null:
		if base == EventBase:
			return true
		base = base.get_base_script()
	return false


static func _find_watch(requirement_id: int, callback: Callable) -> int:
	if not _id_heads.has(requirement_id):
		return -1
	var head: int = _id_heads[requirement_id]
	var link: int = _link_next[head]
	while link != head:
		var slot: int = _link_slot[link]
		if _watches[slot].callback == callback:
			return slot
		link = _link_next[link]
	return -1


## Puts `record` into a slot and into the lists of its requirement ID, its triggers and, when its condition is
## time-dependent, the time-dependent watches. Grows the buffers when no slot is free.
static func _store_watch(record: _WATCH) -> void:
	var slot: int = _watches.size()
	if _free_count == 0:
		_watches.append(record)
		_free_slots.append(-1)
		_pending.append(null)
		_round.append(null)
	else:
		_free_count -= 1
		slot = _free_slots[_free_count]
		_watches[slot] = record
	record.slot = slot
	if not _id_heads.has(record.requirement_id):
		_id_heads[record.requirement_id] = _new_link(-1)
	record.id_link = _add_link(_id_heads[record.requirement_id], slot)
	for trigger: RequirementTrigger in record.triggers:
		match trigger.kind:
			TriggerKind.REQUEST_COMPLETED, TriggerKind.UI_OPENED, TriggerKind.UI_CLOSED:
				var heads: Dictionary[String, int] = _named_heads(trigger.kind)
				if not heads.has(trigger.target_name):
					heads[trigger.target_name] = _new_link(-1)
				record.trigger_links.append(_add_link(heads[trigger.target_name], slot))
	for type: Script in record.event_types:
		if not _content_heads.has(type):
			_content_heads[type] = _new_link(-1)
		record.trigger_links.append(_add_link(_content_heads[type], slot))
	_link_state(record)
	_link_time(record)
	if record.owner_id != 0:
		if _owner_count == _owner_slots.size():
			_owner_slots.append(slot)
		else:
			_owner_slots[_owner_count] = slot
		record.owner_index = _owner_count
		_owner_count += 1


## Puts `record` into the list of each UserState kind that raises its `USER_STATE_CHANGED` triggers: the target kind,
## or every kind its condition sees for an empty target. Each kind once.
static func _link_state(record: _WATCH) -> void:
	var kinds: Array[GDScript] = []
	for trigger: RequirementTrigger in record.triggers:
		if trigger.kind != TriggerKind.USER_STATE_CHANGED:
			continue
		if trigger.user_state_kind != null:
			if not kinds.has(trigger.user_state_kind):
				kinds.append(trigger.user_state_kind)
			continue
		for kind: GDScript in (record.entry as _ENTRY).kinds:
			if not kinds.has(kind):
				kinds.append(kind)
	for kind: GDScript in kinds:
		if not _state_heads.has(kind):
			_state_heads[kind] = _new_link(-1)
		record.state_links.append(_add_link(_state_heads[kind], record.slot))


## Puts `record` into the list of time-dependent watches when its condition is time-dependent and it is not there yet.
static func _link_time(record: _WATCH) -> void:
	if record.time_link >= 0 or not (record.entry as _ENTRY).time_dependent:
		return
	record.time_link = _add_link(_time_head, record.slot)
	_add_time_watch()


## Puts every watch again into the lists that depend on the kinds its condition sees and on whether the condition is
## time-dependent, for `register_judge`, which changes both.
static func _relink_watches() -> void:
	for record: _WATCH in _watches:
		if record == null:
			continue
		for link: int in record.state_links:
			_remove_link(link)
		record.state_links.clear()
		_link_state(record)
		_link_time(record)


## Frame code may call it: changes no collection size.
static func _remove_watch_at(slot: int) -> void:
	var record: _WATCH = _watches[slot]
	if record.owner_id != 0:
		_remove_owner_at(record.owner_index)
	_watches[slot] = null
	_free_slots[_free_count] = slot
	_free_count += 1
	_remove_link(record.id_link)
	for i: int in record.trigger_links.size():
		_remove_link(record.trigger_links[i])
	for i: int in record.state_links.size():
		_remove_link(record.state_links[i])
	if record.time_link >= 0:
		_remove_link(record.time_link)
		_time_watch_count -= 1
	_dequeue(record)
	_unsubscribe_watch(record)


## Takes entry `index` out of the used part of `_owner_slots` by moving the last used entry into it.
static func _remove_owner_at(index: int) -> void:
	_owner_count -= 1
	var moved: int = _owner_slots[_owner_count]
	_owner_slots[index] = moved
	_watches[moved].owner_index = index


# --- watch lists ---


## A link of `slot` that is a ring of its own, which makes it a head link for -1. Grows the pool when no link is free,
## so frame code does not call it.
static func _new_link(slot: int) -> int:
	var link: int = _free_link
	if link >= 0:
		_free_link = _link_next[link]
	else:
		link = _link_slot.size()
		_link_next.append(-1)
		_link_prev.append(-1)
		_link_slot.append(-1)
	_link_next[link] = link
	_link_prev[link] = link
	_link_slot[link] = slot
	return link


static func _named_heads(kind: int) -> Dictionary[String, int]:
	match kind:
		TriggerKind.REQUEST_COMPLETED:
			return _request_heads
		TriggerKind.UI_OPENED:
			return _opened_heads
	return _closed_heads


## Puts a new link of `slot` first into the list of head link `head` and returns it. Frame code does not call it.
static func _add_link(head: int, slot: int) -> int:
	var link: int = _new_link(slot)
	var first: int = _link_next[head]
	_link_next[link] = first
	_link_prev[link] = head
	_link_prev[first] = link
	_link_next[head] = link
	return link


## Takes `link` out of its list and chains it to the unused links. Changes no collection size.
static func _remove_link(link: int) -> void:
	var prev: int = _link_prev[link]
	var next: int = _link_next[link]
	_link_next[prev] = next
	_link_prev[next] = prev
	_link_next[link] = _free_link
	_link_prev[link] = -1
	_link_slot[link] = -1
	_free_link = link


## Marks every watch of the list of head link `head`. Nothing for -1.
static func _mark_list(head: int) -> void:
	if head < 0:
		return
	var link: int = _link_next[head]
	while link != head:
		_mark(_watches[_link_slot[link]])
		link = _link_next[link]


## Subscribes to the events of the triggers of `record` that no other watch subscribes to yet. On a failure undoes
## what it subscribed and returns false.
static func _subscribe_watch(record: _WATCH) -> bool:
	for kind: int in _TRIGGER_KINDS:
		if record.kinds_mask & (1 << kind) == 0:
			continue
		if _kind_counts[kind] == 0 and not EventCore.subscribe(_kind_event(kind), _kind_callback(kind)):
			_unsubscribe_partial(record, kind, 0)
			return false
		_kind_counts[kind] += 1
	for i: int in record.event_types.size():
		var type: Script = record.event_types[i]
		var count: int = _content_counts[type] if _content_counts.has(type) else 0
		if count == 0 and not EventCore.subscribe(type, _node.on_content_event):
			_unsubscribe_partial(record, _TRIGGER_KINDS, i)
			return false
		_content_counts[type] = count + 1
	return true


## Undoes the subscriptions of `record` for trigger kinds before `kind_end` and content event types before
## `type_end`.
static func _unsubscribe_partial(record: _WATCH, kind_end: int, type_end: int) -> void:
	for kind: int in kind_end:
		if record.kinds_mask & (1 << kind) != 0:
			_unsubscribe_kind(kind)
	for i: int in type_end:
		_unsubscribe_content(record.event_types[i])


static func _unsubscribe_watch(record: _WATCH) -> void:
	_unsubscribe_partial(record, _TRIGGER_KINDS, record.event_types.size())


static func _unsubscribe_kind(kind: int) -> void:
	_kind_counts[kind] -= 1
	if _kind_counts[kind] == 0 and EventCore.is_initialized():
		EventCore.unsubscribe(_kind_event(kind), _kind_callback(kind))


static func _unsubscribe_content(type: Script) -> void:
	if not _content_counts.has(type):
		return
	_content_counts[type] -= 1
	if _content_counts[type] == 0 and EventCore.is_initialized():
		EventCore.unsubscribe(type, _node.on_content_event)


static func _kind_event(kind: int) -> Script:
	match kind:
		TriggerKind.USER_STATE_CHANGED:
			return UserStateChangedEvent
		TriggerKind.REQUEST_COMPLETED:
			return RequestCompletedEvent
		TriggerKind.UI_OPENED:
			return UIOpenedEvent
	return UIClosedEvent


static func _kind_callback(kind: int) -> Callable:
	match kind:
		TriggerKind.USER_STATE_CHANGED:
			return _node.on_user_state_changed
		TriggerKind.REQUEST_COMPLETED:
			return _node.on_request_completed
		TriggerKind.UI_OPENED:
			return _node.on_ui_opened
	return _node.on_ui_closed


## Counts one more watch of a time-dependent condition. When it is the first one, the time recheck starts from now.
static func _add_time_watch() -> void:
	if _time_watch_count == 0:
		_recheck_at = TimeCore.get_real_time() + _recheck_ms
	_time_watch_count += 1


## Puts `record` into the pending evaluations of the next round, unless it is a pending evaluation already: in the
## next round or in the running round, not judged yet.
static func _mark(record: _WATCH) -> void:
	if record.queue != _QUEUE_NONE:
		return
	record.queue = _QUEUE_PENDING
	record.queue_index = _pending_count
	_pending[_pending_count] = record
	_pending_count += 1


## Takes `record` out of the pending buffer it is in by moving the last used entry of that buffer into its index.
static func _dequeue(record: _WATCH) -> void:
	var index: int = record.queue_index
	if record.queue == _QUEUE_PENDING:
		_pending_count -= 1
		var moved: _WATCH = _pending[_pending_count]
		_pending[index] = moved
		moved.queue_index = index
		_pending[_pending_count] = null
	elif record.queue == _QUEUE_ROUND:
		_round_count -= 1
		var moved: _WATCH = _round[_round_count]
		_round[index] = moved
		moved.queue_index = index
		_round[_round_count] = null
	record.queue = _QUEUE_NONE
	record.queue_index = -1


# --- internal: core node ---


## Frame code: removes the watches of destroyed owner objects, marks the time-dependent watches at each time recheck,
## then runs the batch evaluation.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	# Backward, so a removal moves into index i only an entry that was already checked.
	for i: int in range(_owner_count - 1, -1, -1):
		var slot: int = _owner_slots[i]
		if not is_instance_id_valid(_watches[slot].owner_id):
			_remove_watch_at(slot)
	if _time_watch_count > 0:
		var now: int = TimeCore.get_real_time()
		if now >= _recheck_at:
			_recheck_at = now + _recheck_ms
			_mark_time_watches()
	if _pending_count > 0:
		_run_batch()


## The batch evaluation: rounds of the watches that were pending evaluations when the round started. A round swaps
## the pending buffer with the empty round buffer and judges its watches from the last one, so the marks of its
## callbacks go to the next round.
static func _run_batch() -> void:
	var session: RefCounted = _session
	var batch_round: int = 0
	while _pending_count > 0:
		batch_round += 1
		if batch_round > _max_rounds:
			LogCore.log_error(_TAG, "batch evaluation: more than %d rounds; the pending evaluations are dropped" % _max_rounds)
			for i: int in _pending_count:
				_pending[i].queue = _QUEUE_NONE
				_pending[i].queue_index = -1
				_pending[i] = null
			_pending_count = 0
			return
		var buffer: Array[_WATCH] = _round
		_round = _pending
		_round_count = _pending_count
		_pending = buffer
		_pending_count = 0
		for i: int in _round_count:
			_round[i].queue = _QUEUE_ROUND
		while _round_count > 0:
			_round_count -= 1
			var record: _WATCH = _round[_round_count]
			_round[_round_count] = null
			record.queue = _QUEUE_NONE
			record.queue_index = -1
			if record.owner_id != 0 and not is_instance_id_valid(record.owner_id):
				_remove_watch_at(record.slot)
				continue
			var result: RequirementResult = _evaluate_entry(record.entry as _ENTRY)
			if result.passed == record.base_passed and result.failed_requirement_id == record.base_failed_id:
				continue
			record.base_passed = result.passed
			record.base_failed_id = result.failed_requirement_id
			if not record.callback.is_valid():
				LogCore.log_error(_TAG, "the watch callback of requirement %d cannot be called; the watch is removed" % record.requirement_id)
				_remove_watch_at(record.slot)
				continue
			record.callback.call(record.requirement_id, result)
			if _session != session:
				return


static func _on_user_state_changed(kind: GDScript) -> void:
	if _state_heads.has(kind):
		_mark_list(_state_heads[kind])


## A `REQUEST_COMPLETED`, `UI_OPENED` or `UI_CLOSED` trigger with target `target_name`.
static func _on_named_trigger(kind: TriggerKind, target_name: String) -> void:
	var heads: Dictionary[String, int] = _named_heads(kind)
	if heads.has(target_name):
		_mark_list(heads[target_name])


static func _on_content_event(type: Script) -> void:
	if _content_heads.has(type):
		_mark_list(_content_heads[type])


## Marks every watch of a time-dependent condition as a pending evaluation.
static func _mark_time_watches() -> void:
	_mark_list(_time_head)


## The core node left the tree outside `release`: app exit or tree teardown. Cleans up as `release` does without
## detaching the node.
static func _on_node_exit(node: Node) -> void:
	if node != _node:
		return
	if EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	_node = null
	_reset()


static func _reset() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_max_rounds = 0
	_recheck_ms = 0
	_judges = {}
	_entries = {}
	_entry_list = []
	_building = {}
	_zero = RequirementResult.new()
	_watches = []
	_free_slots = PackedInt32Array()
	_free_count = 0
	_pending = []
	_pending_count = 0
	_round = []
	_round_count = 0
	_owner_slots = PackedInt32Array()
	_owner_count = 0
	_link_next = PackedInt32Array()
	_link_prev = PackedInt32Array()
	_link_slot = PackedInt32Array()
	_free_link = -1
	_id_heads = {}
	_state_heads = {}
	_request_heads = {}
	_opened_heads = {}
	_closed_heads = {}
	_content_heads = {}
	_time_head = -1
	_time_watch_count = 0
	_recheck_at = 0
	_kind_counts = PackedInt32Array([0, 0, 0, 0, 0])
	_content_counts = {}
	_logged_ids = {}
	_logged_types = {}
