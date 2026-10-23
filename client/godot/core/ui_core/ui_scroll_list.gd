class_name UIScrollList
extends Control
## Component that scrolls item UIs of one prefab along its scroll axis. Only the items over the visible area have an
## item UI, borrowed from `PoolCore` with this list as owner object, so the list size does not bound the item count.

## Resource key of the item prefab. Its root is a `Control` whose script extends `PoolObject`.
@export var item_prefab: String = ""
## `true`: a vertical list. `false`: a horizontal list.
@export var vertical: bool = true
## Item size (width, height) in the units of `Control.size`.
@export var item_size: Vector2 = Vector2.ZERO
@export var size_mode: UICore.UIScrollSizeMode = UICore.UIScrollSizeMode.FIXED
## Space between lines along the scroll axis.
@export var item_spacing: float = 0.0
## Items in one line (1 or more).
@export var cross_axis_count: int = 1
## Space between the items of one line.
@export var cross_axis_spacing: float = 0.0
## Resource key of the loading item prefab. Empty: no loading item.
@export var loading_item_prefab: String = ""
## Keeps the scroll position at the end while it is at the end and items grow.
@export var end_follow: bool = false

## Scroll distance of one mouse wheel step, in item sizes along the scroll axis.
const _WHEEL_STEP_ITEMS: float = 0.5
const _MEASURE_NEXT: int = 1
const _MEASURE_LATER: int = 2

var _has_items: bool = false
var _set_serial: int = 0
var _count: int = 0
var _bind: Callable = Callable()
var _end_near: Callable = Callable()
var _start_near: Callable = Callable()
var _scope: Scope = null
var _offset: float = 0.0
## Measured size by index for `MEASURED`; -1 is not measured.
var _measured: PackedFloat64Array = PackedFloat64Array()
## Fenwick tree of the line pitches (line size and item spacing) for `MEASURED`, 1-based: a measured size change
## updates it and a line start reads it in O(log n). Empty for `FIXED`: its lines all have the same pitch.
var _pitch_tree: PackedFloat64Array = PackedFloat64Array()
var _line_count: int = 0
# Borrowed item UIs. Slots `[0, _slot_used)` are in use.
var _slot_nodes: Array[Control] = []
var _slot_handles: Array[Vector4i] = []
var _slot_indices: PackedInt64Array = PackedInt64Array()
## Measure state by slot: 0 measured or `FIXED`, `_MEASURE_NEXT` read by the queued `_measure`, `_MEASURE_LATER` bound
## after `_measure` was queued, so its own deferred layout is queued after that call and the call after it reads it.
var _slot_measure: PackedByteArray = PackedByteArray()
var _slot_used: int = 0
var _loading_on: bool = false
var _loading_handle: Vector4i = Vector4i.ZERO
var _loading_node: Control = null
var _end_armed: bool = false
var _start_armed: bool = false
## An item UI bound since the last measure waits for its measured size.
var _measure_pending: bool = false
## A deferred `_measure` call is queued.
var _measure_queued: bool = false
var _dragging: bool = false
var _on_item_input: Callable = Callable()


func _init() -> void:
	clip_contents = true
	_on_item_input = _item_gui_input


func _enter_tree() -> void:
	if _has_items and PoolCore.is_initialized():
		_layout()


## Out of the tree the list holds no item UI: they go back to the pool before the scope of the panel or popup that
## holds the list is released.
func _exit_tree() -> void:
	if PoolCore.is_initialized():
		_return_all()
		_return_loading()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and _has_items:
		_clamp_offset()
		_layout()
		_judge()


## Async. Sets the item count and binds the items over the visible area with `bind`(item UI, index). The pools are
## filled first. A newer `set_items` ends a waiting one with `false` and no bind.
func set_items(
		count: int, bind: Callable, pool_scope: Scope, end_near: Callable = Callable(), start_near: Callable = Callable(),
		from_end: bool = false
) -> bool:
	if not _check_set_items(count):
		return false
	_set_serial += 1
	var serial: int = _set_serial
	var items: Array[PrefillItem] = []
	var item: PrefillItem = PrefillItem.new()
	item.resource_key = item_prefab
	item.pool_scope = pool_scope
	item.count = _max_visible_items()
	items.append(item)
	if not loading_item_prefab.is_empty():
		var loading: PrefillItem = PrefillItem.new()
		loading.resource_key = loading_item_prefab
		loading.pool_scope = pool_scope
		loading.count = 1
		items.append(loading)
	await PoolCore.prefill(items)
	if serial != _set_serial or not is_inside_tree():
		return false
	_return_all()
	_return_loading()
	_loading_on = false
	_scope = pool_scope
	_bind = bind
	_end_near = end_near
	_start_near = start_near
	_count = count
	_measured = PackedFloat64Array()
	if size_mode == UICore.UIScrollSizeMode.MEASURED:
		_measured.resize(count)
		_measured.fill(-1.0)
	_rebuild_lines()
	_has_items = true
	_end_armed = true
	_start_armed = true
	if from_end:
		_offset = _max_offset()
	_clamp_offset()
	_layout()
	_judge()
	return true


## Adds `count` items at the end. Does not wait.
func append_items(count: int) -> bool:
	if not _has_items:
		LogCore.log_error(UICore._TAG, "append_items: no set_items before")
		return false
	if count < 1:
		LogCore.log_error(UICore._TAG, "append_items: count %d is below 1" % count)
		return false
	var at_end: bool = _offset >= _max_offset()
	_count += count
	if size_mode == UICore.UIScrollSizeMode.MEASURED:
		var old: int = _measured.size()
		_measured.resize(_count)
		for i: int in range(old, _count):
			_measured[i] = -1.0
	_rebuild_lines()
	if end_follow and at_end:
		_offset = _max_offset()
	_clamp_offset()
	_end_armed = true
	_layout()
	_judge()
	return true


## Adds `count` items in front of a list of cross axis count 1. Does not wait. The items on screen keep their screen
## position and item UI.
func prepend_items(count: int) -> bool:
	if not _has_items:
		LogCore.log_error(UICore._TAG, "prepend_items: no set_items before")
		return false
	if count < 1:
		LogCore.log_error(UICore._TAG, "prepend_items: count %d is below 1" % count)
		return false
	if cross_axis_count != 1:
		LogCore.log_error(UICore._TAG, "prepend_items: cross axis count is not 1")
		return false
	for slot: int in _slot_used:
		_slot_indices[slot] += count
	if size_mode == UICore.UIScrollSizeMode.MEASURED:
		var front: PackedFloat64Array = PackedFloat64Array()
		front.resize(count)
		front.fill(-1.0)
		front.append_array(_measured)
		_measured = front
	_count += count
	_rebuild_lines()
	if count < _line_count:
		_offset += _line_start(count)
	_clamp_offset()
	_start_armed = true
	_layout()
	_judge()
	return true


## Shows or hides the loading item in the line after the last line.
func set_loading(on: bool) -> void:
	if loading_item_prefab.is_empty() or on == _loading_on:
		return
	_loading_on = on
	if not on:
		_return_loading()
	if _has_items:
		_clamp_offset()
		_layout()
		_judge()


func get_scroll_offset() -> float:
	return _offset


func set_scroll_offset(offset: float) -> void:
	if not is_finite(offset):
		LogCore.log_error(UICore._TAG, "set_scroll_offset: offset is not finite")
		return
	_set_offset(offset)


## Scrolls to the start of the line of item `index`.
func scroll_to_index(index: int) -> bool:
	if index < 0 or index >= _count:
		LogCore.log_error(UICore._TAG, "scroll_to_index: index %d is outside the %d items" % [index, _count])
		return false
	_set_offset(_line_start(index / _cross_count()))
	return true


func scroll_to_end() -> void:
	_set_offset(_max_offset())


func _gui_input(event: InputEvent) -> void:
	if not _has_items:
		return
	var mouse_button: InputEventMouseButton = event as InputEventMouseButton
	if mouse_button != null:
		if mouse_button.button_index == MOUSE_BUTTON_LEFT:
			_dragging = mouse_button.pressed
		elif mouse_button.pressed and (mouse_button.button_index == MOUSE_BUTTON_WHEEL_UP
				or mouse_button.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var step: float = _axis(item_size) * _WHEEL_STEP_ITEMS
			_set_offset(_offset - step if mouse_button.button_index == MOUSE_BUTTON_WHEEL_UP else _offset + step)
			accept_event()
		return
	var drag: InputEventScreenDrag = event as InputEventScreenDrag
	if drag != null:
		_set_offset(_offset - _axis(drag.relative))
		accept_event()
		return
	var motion: InputEventMouseMotion = event as InputEventMouseMotion
	if motion != null and _dragging and (motion.button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
		_set_offset(_offset - _axis(motion.relative))
		accept_event()


## Index of the item whose item UI is `node`, or -1.
func _index_of_item(node: Node) -> int:
	for slot: int in _slot_used:
		if _slot_nodes[slot] == node:
			return _slot_indices[slot]
	return -1


## Item UI of `index`, or `null` when it has none.
func _item_ui(index: int) -> Control:
	for slot: int in _slot_used:
		if _slot_indices[slot] == index:
			return _slot_nodes[slot]
	return null


func _check_set_items(count: int) -> bool:
	var problem: String = ""
	if count < 0:
		problem = "count %d is below 0" % count
	elif item_prefab.is_empty():
		problem = "no item prefab key"
	elif not (item_size.x > 0.0 and item_size.y > 0.0):
		problem = "item size is not above 0"
	elif not (item_spacing >= 0.0 and cross_axis_spacing >= 0.0):
		problem = "item spacing or cross axis spacing is below 0"
	elif cross_axis_count < 1:
		problem = "cross axis count is below 1"
	elif size_mode == UICore.UIScrollSizeMode.MEASURED and cross_axis_count != 1:
		problem = "MEASURED with cross axis count %d" % cross_axis_count
	elif size_mode != UICore.UIScrollSizeMode.FIXED and size_mode != UICore.UIScrollSizeMode.MEASURED:
		problem = "unknown size mode"
	if problem.is_empty():
		return true
	LogCore.log_error(UICore._TAG, "set_items: " + problem)
	return false


func _cross_count() -> int:
	return maxi(cross_axis_count, 1)


func _axis(value: Vector2) -> float:
	return value.y if vertical else value.x


func _cross(value: Vector2) -> float:
	return value.x if vertical else value.y


func _view_length() -> float:
	return _axis(size)


## Most items that can be over the visible area at once, with estimated sizes.
func _max_visible_items() -> int:
	var pitch: float = _axis(item_size) + item_spacing
	var lines: int = 1
	if pitch > 0.0:
		lines = ceili(_view_length() / pitch) + 1
	return maxi(lines, 1) * _cross_count()


func _line_size(line: int) -> float:
	if size_mode == UICore.UIScrollSizeMode.MEASURED and line < _measured.size() and _measured[line] >= 0.0:
		return _measured[line]
	return _axis(item_size)


func _rebuild_lines() -> void:
	var n: int = _cross_count()
	_line_count = (_count + n - 1) / n
	if size_mode != UICore.UIScrollSizeMode.MEASURED:
		_pitch_tree = PackedFloat64Array()
		return
	_pitch_tree.resize(_line_count + 1)
	_pitch_tree[0] = 0.0
	for line: int in _line_count:
		_pitch_tree[line + 1] = _line_size(line) + item_spacing
	for i: int in range(1, _line_count + 1):
		var parent: int = i + (i & -i)
		if parent <= _line_count:
			_pitch_tree[parent] += _pitch_tree[i]


## Scroll axis distance from the list start to line `line`: the pitches of the lines before it.
func _line_start(line: int) -> float:
	if _pitch_tree.is_empty():
		return line * (_axis(item_size) + item_spacing)
	var start: float = 0.0
	var i: int = line
	while i > 0:
		start += _pitch_tree[i]
		i -= i & -i
	return start


## Adds `delta` to the pitch of line `line` in `MEASURED`.
func _add_line_pitch(line: int, delta: float) -> void:
	if _pitch_tree.is_empty():
		return
	var i: int = line + 1
	while i <= _line_count:
		_pitch_tree[i] += delta
		i += i & -i


## Length of the lines and the spacing between them, without the loading item.
func _content_lines_length() -> float:
	if _line_count == 0:
		return 0.0
	return _line_start(_line_count - 1) + _line_size(_line_count - 1)


func _loading_line_start() -> float:
	return _content_lines_length() + item_spacing if _line_count > 0 else 0.0


func _content_length() -> float:
	if _loading_on:
		return _loading_line_start() + _axis(item_size)
	return _content_lines_length()


func _max_offset() -> float:
	return maxf(0.0, _content_length() - _view_length())


func _clamp_offset() -> void:
	_offset = clampf(_offset, 0.0, _max_offset())


func _set_offset(offset: float) -> void:
	var clamped: float = clampf(offset, 0.0, _max_offset())
	if clamped == _offset:
		return
	_offset = clamped
	if _has_items:
		_layout()
		_judge()


## First line over the visible area, or `_line_count` when none.
func _first_visible_line() -> int:
	var low: int = 0
	var high: int = _line_count
	while low < high:
		var middle: int = (low + high) / 2
		if _line_start(middle) + _line_size(middle) > _offset:
			high = middle
		else:
			low = middle + 1
	if low < _line_count and _line_start(low) >= _offset + _view_length():
		return _line_count
	return low


## Last item index over the visible area, or -1. `first` is the first visible line.
func _last_visible_index(first: int) -> int:
	if first >= _line_count:
		return -1
	var end: float = _offset + _view_length()
	var line: int = first
	var next_start: float = _line_start(first) + _line_size(first) + item_spacing
	while line + 1 < _line_count and next_start < end:
		line += 1
		next_start += _line_size(line) + item_spacing
	return mini(_count, (line + 1) * _cross_count()) - 1


func _layout() -> void:
	var first_line: int = _first_visible_line()
	var first: int = first_line * _cross_count()
	var last: int = _last_visible_index(first_line)
	var slot: int = 0
	while slot < _slot_used:
		var index: int = _slot_indices[slot]
		if index < first or index > last or index >= _count:
			_return_slot(slot)
		else:
			slot += 1
	for index: int in range(first, last + 1):
		if _item_ui(index) == null:
			_borrow_item(index)
	for used: int in _slot_used:
		_place(_slot_nodes[used], _slot_indices[used])
	if _loading_on:
		if _loading_node == null or not is_instance_valid(_loading_node) or not PoolCore.is_valid(_loading_handle):
			_borrow_loading()
		if _loading_node != null:
			_loading_node.size = item_size
			var start: float = _loading_line_start() - _offset
			_loading_node.position = Vector2(0.0, start) if vertical else Vector2(start, 0.0)
	if _measure_pending and not _measure_queued:
		_measure_queued = true
		_measure.call_deferred()


func _place(node: Control, index: int) -> void:
	var n: int = _cross_count()
	var line: int = index / n
	var axis_position: float = _line_start(line) - _offset if line < _line_count else 0.0
	var cross_position: float = (index % n) * (_cross(item_size) + cross_axis_spacing)
	if size_mode == UICore.UIScrollSizeMode.MEASURED:
		var cross_length: float = _cross(size)
		node.size = Vector2(cross_length, _line_size(line)) if vertical else Vector2(_line_size(line), cross_length)
	else:
		node.size = item_size
	node.position = Vector2(cross_position, axis_position) if vertical else Vector2(axis_position, cross_position)


func _borrow_item(index: int) -> void:
	var handle: Vector4i = PoolCore.borrow(item_prefab, _scope, self)
	if not PoolCore.is_valid(handle):
		return
	var node: Control = PoolCore.get_instance(handle) as Control
	if node == null:
		LogCore.log_error(UICore._TAG, "UIScrollList: the root of item prefab %s is not a Control" % item_prefab)
		PoolCore.give_back(handle)
		return
	if _slot_used == _slot_nodes.size():
		var grown: int = maxi(_slot_used * 2, 8)
		_slot_nodes.resize(grown)
		_slot_handles.resize(grown)
		_slot_indices.resize(grown)
		_slot_measure.resize(grown)
	var slot: int = _slot_used
	_slot_used += 1
	_slot_nodes[slot] = node
	_slot_handles[slot] = handle
	_slot_indices[slot] = index
	_slot_measure[slot] = 0
	if size_mode == UICore.UIScrollSizeMode.MEASURED:
		_slot_measure[slot] = _MEASURE_LATER if _measure_queued else _MEASURE_NEXT
		_measure_pending = true
	add_child(node)
	_connect_buttons(node, true)
	_place(node, index)
	if _bind.is_valid():
		_bind.call(node, index)
	elif not _bind.is_null():
		LogCore.log_error(UICore._TAG, "UIScrollList: the bind callback cannot be called")
		_bind = Callable()


func _return_slot(slot: int) -> void:
	var node: Control = _slot_nodes[slot]
	var handle: Vector4i = _slot_handles[slot]
	if is_instance_valid(node):
		_connect_buttons(node, false)
	var last: int = _slot_used - 1
	_slot_nodes[slot] = _slot_nodes[last]
	_slot_handles[slot] = _slot_handles[last]
	_slot_indices[slot] = _slot_indices[last]
	_slot_measure[slot] = _slot_measure[last]
	_slot_nodes[last] = null
	_slot_used = last
	if PoolCore.is_valid(handle):
		PoolCore.give_back(handle)


func _return_all() -> void:
	while _slot_used > 0:
		_return_slot(_slot_used - 1)


func _borrow_loading() -> void:
	_loading_node = null
	if _scope == null:
		return
	var handle: Vector4i = PoolCore.borrow(loading_item_prefab, _scope, self)
	if not PoolCore.is_valid(handle):
		return
	var node: Control = PoolCore.get_instance(handle) as Control
	if node == null:
		LogCore.log_error(UICore._TAG, "UIScrollList: the root of loading item prefab %s is not a Control" % loading_item_prefab)
		PoolCore.give_back(handle)
		return
	_loading_handle = handle
	_loading_node = node
	add_child(node)


func _return_loading() -> void:
	if PoolCore.is_valid(_loading_handle):
		PoolCore.give_back(_loading_handle)
	_loading_handle = Vector4i.ZERO
	_loading_node = null


## Judges the item counts left after and before the visible area and calls the near callbacks.
func _judge() -> void:
	if not _has_items:
		return
	var first_line: int = _first_visible_line()
	var last: int = _last_visible_index(first_line)
	var threshold: int = UICore._scroll_load_threshold
	if _end_armed and _count - 1 - last <= threshold:
		_end_armed = false
		_call(_end_near)
	if _start_armed and last >= 0 and first_line * _cross_count() <= threshold:
		_start_armed = false
		_call(_start_near)


func _call(callback: Callable) -> void:
	if callback.is_null():
		return
	if not callback.is_valid():
		LogCore.log_error(UICore._TAG, "UIScrollList: a near callback cannot be called")
		return
	callback.call()


## Deferred after the code run that bound item UIs, so their own deferred layout runs first: reads the measured size
## of the item UIs bound before this call was queued and lays out again in the same call. The item UIs bound after it
## was queued are read in a call queued here, after their own deferred layout.
func _measure() -> void:
	_measure_queued = false
	if not _measure_pending or not _has_items:
		return
	_measure_pending = false
	var at_end: bool = _offset >= _max_offset()
	var changed: bool = false
	for slot: int in _slot_used:
		if _slot_measure[slot] == 0:
			continue
		if _slot_measure[slot] == _MEASURE_LATER:
			_slot_measure[slot] = _MEASURE_NEXT
			_measure_pending = true
			continue
		_slot_measure[slot] = 0
		var node: Control = _slot_nodes[slot]
		var index: int = _slot_indices[slot]
		if not is_instance_valid(node) or index >= _measured.size():
			continue
		var before: float = _line_size(index)
		var measured: float = _axis(node.get_combined_minimum_size())
		_measured[index] = measured
		if measured == before:
			continue
		changed = true
		if _line_start(index) < _offset:
			_offset += measured - before
		_add_line_pitch(index, measured - before)
	if _measure_pending:
		_measure_queued = true
		_measure.call_deferred()
	if not changed:
		return
	if end_follow and at_end:
		_offset = _max_offset()
	_clamp_offset()
	_layout()
	_judge()


## Connects or disconnects `gui_input` of every `Control` with a `UIButton` child under `node`.
func _connect_buttons(node: Node, connect_input: bool) -> void:
	var control: Control = node as Control
	if control != null and UICore._has_ui_button(control):
		if connect_input and not control.gui_input.is_connected(_on_item_input):
			if control.gui_input.connect(_on_item_input) != OK:
				LogCore.log_error(UICore._TAG, "UIScrollList: gui_input connect failed")
		elif not connect_input and control.gui_input.is_connected(_on_item_input):
			control.gui_input.disconnect(_on_item_input)
	for i: int in node.get_child_count():
		_connect_buttons(node.get_child(i), connect_input)


## Focus scroll: a scroll axis direction input on a focused button of an item UI scrolls to the next line when that
## line does not fit in the visible area, and moves the focus there.
func _item_gui_input(event: InputEvent) -> void:
	var forward: bool = false
	if vertical and event.is_action_pressed(&"ui_down", true, true):
		forward = true
	elif not vertical and event.is_action_pressed(&"ui_right", true, true):
		forward = true
	elif not (vertical and event.is_action_pressed(&"ui_up", true, true)) \
			and not (not vertical and event.is_action_pressed(&"ui_left", true, true)):
		return
	var focus: Control = get_viewport().gui_get_focus_owner()
	if focus == null:
		return
	var index: int = -1
	for slot: int in _slot_used:
		var item: Control = _slot_nodes[slot]
		if item == focus or item.is_ancestor_of(focus):
			index = _slot_indices[slot]
			break
	if index < 0:
		return
	var n: int = _cross_count()
	var target_line: int = index / n + (1 if forward else -1)
	if target_line < 0 or target_line >= _line_count:
		return
	var start: float = _line_start(target_line)
	var line_end: float = start + _line_size(target_line)
	if start >= _offset and line_end <= _offset + _view_length():
		return
	focus.accept_event()
	_set_offset(line_end - _view_length() if forward else start)
	var target: int = mini(target_line * n + index % n, _count - 1)
	var item_ui: Control = _item_ui(target)
	if item_ui == null:
		return
	var button: Control = UICore._first_button_in(item_ui)
	if button != null:
		button.grab_focus()
