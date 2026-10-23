class_name BadgeCore
extends RefCounted
## Badges that show new entries and rewards to take (red dot, count) in a badge tree. A data badge is a `badge` row;
## an item badge is a leaf content code adds under a data badge. The count of child badges propagates to the parent.
## Changes are gathered and applied at the frame end.

const _TAG: String = "BadgeCore"
## `LocalDataCore` `user` file key of the item badges under the data badges whose `persist` is true.
const _ITEMS_KEY: String = "BadgeCore.items"
## Format argument of `[badge_count_over]`.
const _COUNT_ARG: String = "count"
const _BADGE_STATE := preload("res://core/badge_core/badge_state.gd")
const _CORE_NODE := preload("res://core/badge_core/badge_core_node.gd")

static var _is_initialized: bool = false
## Session of this init. An async operation or a deferred frame end that resumes in another session does nothing.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null

static var _refresh_interval_ms: int = 0
static var _max_display_count: int = 0
static var _dot_resource: String = ""
## False when `_read_settings` found a missing key or a value of the wrong type.
static var _settings_ok: bool = true

## Data badges by badge ID value. Made from the `badge` table at the first use after the data load.
static var _badges: Dictionary[int, _BADGE_STATE] = {}
## Every data badge, children before their parent.
static var _order: Array[_BADGE_STATE] = []
static var _tree_made: bool = false

## Evaluator call and requirement judgement of every badge waiting for the frame end.
static var _evaluate_all: bool = false
static var _judge_all: bool = false
## Badges with an evaluator call, a requirement judgement or a recalculation waiting for the frame end.
static var _touched: Array[_BADGE_STATE] = []
## The saved item badges wait to be written at the frame end.
static var _save_pending: bool = false
## `load_saved` read the `user` file: the item badges of persist badges are saved from now on.
static var _saving: bool = false
## The frame end is queued, and the deferred call that runs it in this session.
static var _frame_end_queued: bool = false
static var _frame_end: Callable = Callable()
## Real elapsed time of the next evaluator refresh.
static var _next_refresh_at: int = 0

## Instance IDs of the bound `BadgeView`s.
static var _view_ids: Dictionary[int, bool] = {}
## Dot prefab loaded by `prepare`. `null`: the code made red circle.
static var _dot_prefab: PackedScene = null
static var _format_args: FormatArgs = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not _read_settings():
		_reset_state()
		return false
	_session = RefCounted.new()
	_node = _CORE_NODE.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(_node)
	if not EventCore.subscribe(UserStateChangedEvent, _node._on_user_state_changed):
		LogCore.log_error(_TAG, "could not subscribe to UserStateChangedEvent")
		var node: _CORE_NODE = _node
		node.released = true
		node.get_parent().remove_child(node)
		node.queue_free()
		_reset_state()
		return false
	_frame_end = _run_frame_end.bind(_session)
	_format_args = FormatArgs.new()
	_next_refresh_at = TimeCore.get_real_time() + _refresh_interval_ms
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	_clean_up(true)
	if is_instance_valid(node):
		node.released = true
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Loads the dot prefab `BadgeCore.dotResource` into the global scope. Without it the code made red circle is the
## dot. Async.
static func prepare() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "prepare called before init")
		return false
	_dot_prefab = null
	if _dot_resource == "":
		return true
	var session: RefCounted = _session
	var resource: Resource = await ResourceCore.load(
			_dot_resource, ResourceCore.BaseKind.PACKED_SCENE, ResourceCore.get_global_scope())
	if session != _session:
		return false
	var prefab: PackedScene = resource as PackedScene
	if prefab == null or not ResourceCore.is_loaded(_dot_resource, ResourceCore.BaseKind.PACKED_SCENE):
		LogCore.log_error(_TAG, "dot prefab %s did not load; the code made red circle is used" % _dot_resource)
		return false
	var probe: Node = prefab.instantiate()
	var is_control: bool = probe is Control
	if probe != null:
		probe.free()
	if not is_control:
		LogCore.log_error(_TAG, "dot prefab %s has no Control root; the code made red circle is used" % _dot_resource)
		return false
	_dot_prefab = prefab
	return true


static func register_evaluator(badge_id: int, evaluator: Callable) -> bool:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "register_evaluator")
	if badge == null:
		return false
	if not (evaluator.is_valid() and evaluator.is_standard() and evaluator.get_object() is Script):
		LogCore.log_error(_TAG, "register_evaluator got an evaluator that is not a static func")
		return false
	if not badge.evaluator.is_null():
		LogCore.log_error(_TAG, "register_evaluator: badge %d already has an evaluator; the first is kept" % badge_id)
		return false
	badge.evaluator = evaluator
	badge.evaluate_pending = true
	badge.judge_pending = true
	_touch(badge)
	_queue_frame_end()
	return true


static func set_count(badge_id: int, count: int) -> bool:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "set_count")
	if badge == null:
		return false
	if not badge.evaluator.is_null():
		LogCore.log_error(_TAG, "set_count of badge %d that has an evaluator" % badge_id)
		return false
	if count < 0:
		LogCore.log_error(_TAG, "set_count of badge %d got a negative count %d" % [badge_id, count])
		return false
	if badge.own_count != count:
		badge.own_count = count
		_own_count_changed(badge)
	return true


static func set_item(badge_id: int, item_key: int, count: int) -> bool:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "set_item")
	if badge == null:
		return false
	if item_key == 0:
		LogCore.log_error(_TAG, "set_item of badge %d got item key 0" % badge_id)
		return false
	if count < 0:
		LogCore.log_error(_TAG, "set_item of badge %d got a negative count %d" % [badge_id, count])
		return false
	_put_item(badge, item_key, count)
	return true


static func clear_item(badge_id: int, item_key: int) -> void:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "clear_item")
	if badge != null:
		_put_item(badge, item_key, 0)


static func clear_items(badge_id: int) -> void:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "clear_items")
	if badge == null:
		return
	for item_key: int in badge.items.keys():
		_put_item(badge, item_key, 0)


## Calls the evaluator of badge `badge_id`, or of every badge when it is 0, at the frame end.
static func refresh(badge_id: int = 0) -> void:
	if badge_id == 0:
		if not _is_initialized:
			LogCore.log_error(_TAG, "refresh called before init")
			return
		_evaluate_all = true
		_judge_all = true
		_queue_frame_end()
		return
	var badge: _BADGE_STATE = _usable_badge(badge_id, "refresh")
	if badge == null:
		return
	badge.evaluate_pending = true
	badge.judge_pending = true
	_touch(badge)
	_queue_frame_end()


## Total count of badge `badge_id` as of the last frame end.
static func get_count(badge_id: int) -> int:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "get_count")
	return badge.total if badge != null else 0


static func get_item_count(badge_id: int, item_key: int) -> int:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "get_item_count")
	return _item_count(badge, item_key) if badge != null else 0


## Adds the item badges saved in the `user` file that memory does not have, and saves from now on.
static func load_saved() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "load_saved called before init")
		return false
	_judge_all = true
	_queue_frame_end()
	if not LocalDataCore.is_loaded(LocalDataCore.FileKind.USER):
		LogCore.log_error(_TAG, "load_saved could not read %s: the user file is not loaded" % _ITEMS_KEY)
		return false
	_make_tree()
	var saved: PackedStringArray = LocalDataCore.get_array_string(LocalDataCore.FileKind.USER, _ITEMS_KEY)
	for element: String in saved:
		var parts: PackedInt64Array = _parse_element(element)
		if parts.is_empty():
			LogCore.log_warn(_TAG, "load_saved dropped a malformed %s element: %s" % [_ITEMS_KEY, element])
			continue
		var badge: _BADGE_STATE = _find_badge(parts[0])
		if badge == null or not badge.persist or badge.items.has(parts[1]):
			continue
		_put_item(badge, parts[1], parts[2])
	_saving = true
	_save_pending = true
	return true


# --- BadgeView ---


static func _bind_view(view: BadgeView, badge_id: int, item_key: int) -> bool:
	var badge: _BADGE_STATE = _usable_badge(badge_id, "BadgeView.bind")
	if badge == null:
		return false
	if not view.get_parent() is Control:
		LogCore.log_error(_TAG, "BadgeView.bind: the BadgeView is not a child of a Control")
		return false
	_forget_view(view)
	view._bound = true
	view._badge_id = badge_id
	view._item_key = item_key
	_view_ids[view.get_instance_id()] = true
	badge.view_ids[view.get_instance_id()] = true
	_show_view(view)
	return true


static func _unbind_view(view: BadgeView) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "BadgeView.unbind called before init")
		return
	_clear_view(view, true)


## A `BadgeView` is being destroyed: cleans up like `unbind`, without a log.
static func _on_view_destroyed(view: BadgeView) -> void:
	_forget_view(view)
	view._bound = false
	if is_instance_valid(view._display):
		view._display.queue_free()
	view._display = null
	view._label = null


## Removes the connection of `view` and its display. `immediate` frees the display now; app exit queues the free.
static func _clear_view(view: BadgeView, immediate: bool) -> void:
	_forget_view(view)
	view._bound = false
	view._badge_id = 0
	view._item_key = 0
	if is_instance_valid(view._display):
		if immediate:
			var parent: Node = view._display.get_parent()
			if parent != null:
				parent.remove_child(view._display)
			view._display.free()
		else:
			view._display.queue_free()
	view._display = null
	view._label = null


## Removes `view` from the bound views and from the views of its badge.
static func _forget_view(view: BadgeView) -> void:
	var view_id: int = view.get_instance_id()
	_view_ids.erase(view_id)
	var badge: _BADGE_STATE = _find_badge(view._badge_id)
	if badge != null:
		badge.view_ids.erase(view_id)


## Shows the count of the connection of `view`: hidden at 0, the dot for `Dot`, the dot and the count for `Count`.
static func _show_view(view: BadgeView) -> void:
	var badge: _BADGE_STATE = _find_badge(view._badge_id)
	if badge == null:
		return
	var count: int = badge.total
	var display: GameData.BadgeDisplay = badge.display
	if view._item_key != 0:
		count = _item_count(badge, view._item_key)
	if count <= 0:
		if is_instance_valid(view._display):
			view._display.visible = false
		return
	var parent: Control = view.get_parent() as Control
	if parent == null:
		return
	if not is_instance_valid(view._display) or view._display.get_parent() != parent:
		if is_instance_valid(view._display):
			view._display.queue_free()
		_make_display(view)
		parent.add_child(view._display, false, Node.INTERNAL_MODE_BACK)
	var text: String = ""
	if display == GameData.BadgeDisplay.COUNT:
		if count > _max_display_count:
			_format_args.clear()
			_format_args.set_int(_COUNT_ARG, _max_display_count)
			text = LocalizationCore.format(ReservedString.badge_count_over(), _format_args)
		else:
			text = str(count)
	view._label.text = text
	view._label.visible = text != ""
	view._display.visible = true
	_fit_code_dot(view)


## Makes the display of `view`: a holder at the top right corner of the UI element, the dot centered on that corner,
## and the count text over the dot. The display takes no pointer input.
static func _make_display(view: BadgeView) -> void:
	var holder: Control = Control.new()
	holder.name = "BadgeDisplay"
	holder.anchor_left = 1.0
	holder.anchor_right = 1.0
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var dot: Control = null
	if _dot_prefab != null:
		dot = _dot_prefab.instantiate() as Control
	if dot == null:
		dot = _make_code_dot()
	_ignore_pointer(dot)
	holder.add_child(dot)
	var label: Label = Label.new()
	label.anchor_right = 1.0
	label.anchor_bottom = 1.0
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_font_size_override("font_size", ThemeDB.fallback_font_size)
	dot.add_child(label, false, Node.INTERNAL_MODE_BACK)
	view._display = holder
	view._label = label


## Code made dot: a red circle as tall as one line of the count text.
static func _make_code_dot() -> Control:
	var dot: Panel = Panel.new()
	dot.name = "CodeDot"
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color.RED
	var diameter: float = _code_dot_diameter()
	style.set_corner_radius_all(roundi(diameter))
	dot.add_theme_stylebox_override("panel", style)
	dot.size = Vector2(diameter, diameter)
	dot.position = -dot.size / 2.0
	return dot


## Widens the code made dot to the count text, keeping it centered on the corner.
static func _fit_code_dot(view: BadgeView) -> void:
	if _dot_prefab != null:
		return
	var dot: Panel = view._label.get_parent() as Panel
	if dot == null:
		return
	var diameter: float = _code_dot_diameter()
	var width: float = diameter
	if view._label.visible:
		width = maxf(diameter, view._label.get_minimum_size().x + diameter / 2.0)
	dot.size = Vector2(width, diameter)
	dot.position = -dot.size / 2.0


## Height of the code made dot: one and a half times the count text size. A corner radius this large is clamped to a
## half circle.
static func _code_dot_diameter() -> float:
	return roundf(ThemeDB.fallback_font_size * 1.5)


static func _ignore_pointer(node: Node) -> void:
	var control: Control = node as Control
	if control != null:
		control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i: int in node.get_child_count():
		_ignore_pointer(node.get_child(i))


# --- frame end ---


## Every frame: queues the evaluator refresh of every badge each `BadgeCore.refreshIntervalMs`.
static func _on_frame() -> void:
	if not _is_initialized or _refresh_interval_ms <= 0:
		return
	var now: int = TimeCore.get_real_time()
	if now < _next_refresh_at:
		return
	_next_refresh_at = now + _refresh_interval_ms
	_evaluate_all = true
	_judge_all = true
	_queue_frame_end()


static func _on_user_state_changed() -> void:
	if not _is_initialized:
		return
	_evaluate_all = true
	_judge_all = true
	_queue_frame_end()


static func _queue_frame_end() -> void:
	if _frame_end_queued:
		return
	_frame_end_queued = true
	_frame_end.call_deferred()


## Frame end: calls the waiting evaluators, judges the waiting requirements, recalculates the total counts of the
## changed badges and their ancestors, shows them, saves the item badges and publishes `BadgeChangedEvent`s, children
## before their parent.
static func _run_frame_end(session: RefCounted) -> void:
	if session != _session:
		return
	_frame_end_queued = false
	_make_tree()
	if not _tree_made:
		_evaluate_all = false
		_judge_all = false
		return
	var evaluate_all: bool = _evaluate_all
	_evaluate_all = false
	_touched.sort_custom(_is_before)
	var evaluated: Array[_BADGE_STATE] = _order
	if not evaluate_all:
		evaluated = _touched.duplicate()
	for badge: _BADGE_STATE in evaluated:
		if (evaluate_all or badge.evaluate_pending) and not badge.evaluator.is_null():
			_call_evaluator(badge)
		badge.evaluate_pending = false
	var judge_all: bool = _judge_all
	_judge_all = false
	var judged: Array[_BADGE_STATE] = _order
	if not judge_all:
		judged = _touched.duplicate()
	for badge: _BADGE_STATE in judged:
		if (judge_all or badge.judge_pending) and badge.requirement != 0:
			var passed: bool = RequirementCore.evaluate(badge.requirement).passed
			if passed != badge.passed:
				badge.passed = passed
				badge.recalc_pending = true
				_touch(badge)
		badge.judge_pending = false
	var recalculated: Array[_BADGE_STATE] = _recalculated_badges()
	var event_badges: PackedInt64Array = PackedInt64Array()
	var event_items: PackedInt64Array = PackedInt64Array()
	var event_counts: PackedInt64Array = PackedInt64Array()
	var shown: Array[_BADGE_STATE] = []
	var shown_items: Array[PackedInt64Array] = []
	var shown_totals: Array[bool] = []
	for badge: _BADGE_STATE in recalculated:
		var changed_items: PackedInt64Array = PackedInt64Array()
		for item_key: int in badge.items_before:
			var count: int = _item_count(badge, item_key)
			if count != badge.items_before[item_key]:
				changed_items.append(item_key)
				event_badges.append(badge.id)
				event_items.append(item_key)
				event_counts.append(count)
		badge.items_before.clear()
		var total: int = 0
		if badge.passed:
			total = badge.own_count + badge.item_sum
			for child_id: int in badge.children:
				total += _badges[child_id].total
		var total_changed: bool = total != badge.total
		if total_changed:
			badge.total = total
			event_badges.append(badge.id)
			event_items.append(0)
			event_counts.append(total)
		if total_changed or not changed_items.is_empty():
			shown.append(badge)
			shown_items.append(changed_items)
			shown_totals.append(total_changed)
	if _save_pending:
		_save_pending = false
		_save()
	for i: int in shown.size():
		_show_views_of(shown[i], shown_totals[i], shown_items[i])
	for i: int in event_badges.size():
		if session != _session:
			return
		var event: BadgeChangedEvent = EventCore.acquire(BadgeChangedEvent) as BadgeChangedEvent
		event.badge_id = event_badges[i]
		event.item_key = event_items[i]
		event.count = event_counts[i]
		EventCore.publish(event)


## Takes the waiting work off the touched badges and gives the badges to recalculate in the badge order: every badge
## whose own count, item count or requirement judgement changed, and their ancestors.
static func _recalculated_badges() -> Array[_BADGE_STATE]:
	var out: Array[_BADGE_STATE] = []
	var added: Dictionary[int, bool] = {}
	for badge: _BADGE_STATE in _touched:
		var recalc: bool = badge.recalc_pending
		badge.touched = false
		badge.recalc_pending = false
		badge.evaluate_pending = false
		badge.judge_pending = false
		var next: _BADGE_STATE = badge if recalc else null
		while next != null and next.order_index >= 0 and not added.has(next.id):
			added[next.id] = true
			out.append(next)
			var parent: _BADGE_STATE = _find_badge(next.parent_id)
			next = parent if parent != next else null
	_touched.clear()
	out.sort_custom(_is_before)
	return out


static func _is_before(a: _BADGE_STATE, b: _BADGE_STATE) -> bool:
	return a.order_index < b.order_index


## Marks that `badge` has work waiting for the frame end.
static func _touch(badge: _BADGE_STATE) -> void:
	if not badge.touched:
		badge.touched = true
		_touched.append(badge)


static func _call_evaluator(badge: _BADGE_STATE) -> void:
	var result: BadgeEvaluatorResult = _evaluate(badge)
	if result == null:
		LogCore.log_error(_TAG, "the evaluator of badge %d threw or returned no BadgeEvaluatorResult" % badge.id)
		return
	if result.count < 0:
		LogCore.log_error(_TAG, "the evaluator of badge %d returned a negative count %d" % [badge.id, result.count])
		return
	if result.count != badge.own_count:
		badge.own_count = result.count
		badge.recalc_pending = true
		badge.judge_pending = true
		_touch(badge)


## The evaluator output of `badge`. `null` when the evaluator threw (a GDScript runtime error during the call) or its
## output is not a `BadgeEvaluatorResult`.
# ogw:input_boundary
static func _evaluate(badge: _BADGE_STATE) -> BadgeEvaluatorResult:
	var mark: int = CoreScriptErrors.begin()
	var out: Variant = badge.evaluator.call(badge.id)
	if CoreScriptErrors.end(mark):
		return null
	if out is BadgeEvaluatorResult:
		var result: BadgeEvaluatorResult = out
		return result
	return null


## Shows the views bound to `badge` whose count changed: the badge itself when `total_changed`, and the item
## badges in `item_keys`.
static func _show_views_of(badge: _BADGE_STATE, total_changed: bool, item_keys: PackedInt64Array) -> void:
	for view_id: int in badge.view_ids.keys():
		if not is_instance_id_valid(view_id):
			badge.view_ids.erase(view_id)
			_view_ids.erase(view_id)
			continue
		var view: BadgeView = instance_from_id(view_id) as BadgeView
		if view == null or not view._bound or view._badge_id != badge.id:
			continue
		if (view._item_key == 0 and total_changed) or (view._item_key != 0 and item_keys.has(view._item_key)):
			_show_view(view)


## Writes the item badges of every persist badge: `<badge ID>:<item key>=<count>` each.
static func _save() -> void:
	if not _saving:
		return
	var out: PackedStringArray = PackedStringArray()
	for badge: _BADGE_STATE in _order:
		if not badge.persist:
			continue
		for item_key: int in badge.items:
			out.append("%d:%d=%d" % [badge.id, item_key, badge.items[item_key]])
	LocalDataCore.set_array_string(LocalDataCore.FileKind.USER, _ITEMS_KEY, out)


# --- badge tree ---


## Puts the count of item badge `item_key` of `badge`; 0 removes it.
static func _put_item(badge: _BADGE_STATE, item_key: int, count: int) -> void:
	var before: int = _item_count(badge, item_key)
	if before == count:
		return
	if not badge.items_before.has(item_key):
		badge.items_before[item_key] = before
	if count == 0:
		badge.items.erase(item_key)
	else:
		badge.items[item_key] = count
	badge.item_sum += count - before
	if badge.persist and _saving:
		_save_pending = true
	_own_count_changed(badge)


## The own count or an item count of `badge` changed: recalculate and judge its requirement at the frame end.
static func _own_count_changed(badge: _BADGE_STATE) -> void:
	badge.recalc_pending = true
	badge.judge_pending = true
	_touch(badge)
	_queue_frame_end()


## The badge of `badge_id`. Logs an error and gives `null` before init and for an ID not in the `badge` table.
static func _usable_badge(badge_id: int, operation: String) -> _BADGE_STATE:
	if not _is_initialized:
		LogCore.log_error(_TAG, "%s called before init" % operation)
		return null
	_make_tree()
	var badge: _BADGE_STATE = _find_badge(badge_id)
	if badge == null:
		LogCore.log_error(_TAG, "%s got badge ID %d that is not in the badge table" % [operation, badge_id])
	return badge


static func _find_badge(badge_id: int) -> _BADGE_STATE:
	return _badges[badge_id] if _badges.has(badge_id) else null


static func _item_count(badge: _BADGE_STATE, item_key: int) -> int:
	return badge.items[item_key] if badge.items.has(item_key) else 0


## Makes the badge tree from the `badge` table once it has rows: every badge, its children, and the order with the
## children before their parent.
static func _make_tree() -> void:
	if _tree_made:
		return
	var rows: Array[GameData.BadgeRow] = GameData.BadgeTable.all_rows()
	if rows.is_empty():
		return
	for row: GameData.BadgeRow in rows:
		var badge: _BADGE_STATE = _BADGE_STATE.new()
		badge.id = row.id
		badge.parent_id = row.parent
		badge.display = row.display
		badge.persist = row.persist
		badge.requirement = row.requirement
		badge.passed = row.requirement == 0
		_badges[row.id] = badge
	var roots: Array[_BADGE_STATE] = []
	for row: GameData.BadgeRow in rows:
		var badge: _BADGE_STATE = _badges[row.id]
		var parent: _BADGE_STATE = _find_badge(badge.parent_id)
		if parent != null and parent != badge:
			parent.children.append(badge.id)
		else:
			roots.append(badge)
	var placed: Dictionary[int, bool] = {}
	for root: _BADGE_STATE in roots:
		_place_subtree(root, placed)
	_tree_made = true


## Appends the badges of the subtree of `root` to `_order`, children before their parent. A depth-first walk with an
## explicit stack.
static func _place_subtree(root: _BADGE_STATE, placed: Dictionary[int, bool]) -> void:
	var stack: Array[_BADGE_STATE] = [root]
	var next_child: PackedInt64Array = PackedInt64Array([0])
	placed[root.id] = true
	while not stack.is_empty():
		var top: int = stack.size() - 1
		var badge: _BADGE_STATE = stack[top]
		if next_child[top] < badge.children.size():
			var child: _BADGE_STATE = _badges[badge.children[next_child[top]]]
			next_child[top] += 1
			if not placed.has(child.id):
				placed[child.id] = true
				stack.append(child)
				next_child.append(0)
			continue
		badge.order_index = _order.size()
		_order.append(badge)
		stack.remove_at(top)
		next_child.remove_at(top)


## `<badge ID>:<item key>=<count>` as [badge ID, item key, count]. Empty when malformed: not three decimal integers,
## an item key of 0 or a count below 1.
static func _parse_element(element: String) -> PackedInt64Array:
	var colon: int = element.find(":")
	var equals: int = element.find("=")
	if colon <= 0 or equals <= colon + 1 or equals == element.length() - 1:
		return PackedInt64Array()
	var texts: PackedStringArray = PackedStringArray([
		element.substr(0, colon), element.substr(colon + 1, equals - colon - 1), element.substr(equals + 1)
	])
	var values: PackedInt64Array = PackedInt64Array()
	for text: String in texts:
		if not _is_decimal(text):
			return PackedInt64Array()
		values.append(text.to_int())
	if values[1] == 0 or values[2] < 1:
		return PackedInt64Array()
	return values


## Whether `text` is a decimal integer: an optional `-` and ASCII digits that fit in 64 bits.
static func _is_decimal(text: String) -> bool:
	var digits: String = text.trim_prefix("-")
	if digits == "" or digits.length() > 19:
		return false
	for i: int in digits.length():
		var code: int = digits.unicode_at(i)
		if code < 48 or code > 57:
			return false
	return digits.length() < 19 or digits <= "9223372036854775807"


# --- lifecycle ---


## Clean-up when the core node leaves the tree outside `release`: app exit and tree teardown.
static func _on_node_exit() -> void:
	if _is_initialized:
		_clean_up(false)


## `release` and app exit: removes the subscription and the `BadgeView` connections with their displays, and puts
## every static var back to its initial value. Saved values stay.
static func _clean_up(immediate: bool) -> void:
	if is_instance_valid(_node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(_node)
	for view_id: int in _view_ids.keys():
		if is_instance_id_valid(view_id):
			var view: BadgeView = instance_from_id(view_id) as BadgeView
			if view != null:
				_clear_view(view, immediate)
	_reset_state()


static func _reset_state() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_refresh_interval_ms = 0
	_max_display_count = 0
	_dot_resource = ""
	_settings_ok = true
	_badges = {}
	_order = []
	_tree_made = false
	_evaluate_all = false
	_judge_all = false
	_touched = []
	_save_pending = false
	_saving = false
	_frame_end_queued = false
	_frame_end = Callable()
	_next_refresh_at = 0
	_view_ids = {}
	_dot_prefab = null
	_format_args = null


## Reads the settings of the module spec `## settings`. False when a key is missing or has the wrong type.
static func _read_settings() -> bool:
	_settings_ok = true
	_refresh_interval_ms = _read_int("BadgeCore.refreshIntervalMs")
	_max_display_count = _read_int("BadgeCore.maxDisplayCount")
	_dot_resource = _read_string("BadgeCore.dotResource")
	return _settings_ok


static func _read_string(key: String) -> String:
	if not CoreSettings.has_string(key):
		_setting_missing(key)
		return ""
	return CoreSettings.get_string(key)


static func _read_int(key: String) -> int:
	if not CoreSettings.has_int(key):
		_setting_missing(key)
		return 0
	return CoreSettings.get_int(key)


static func _setting_missing(key: String) -> void:
	LogCore.log_error(_TAG, "core setting %s is missing or has the wrong type" % key)
	_settings_ok = false
