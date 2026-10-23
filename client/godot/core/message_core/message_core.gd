class_name MessageCore
extends RefCounted
## Toasts and black box messages: notices shown for a set time and then gone. Each kind shows one message at a time
## on the `Message` UI layer and queues the rest. A popup is not a message; `UICore` shows popups.

## `prepare` state.
const _PREPARE_NONE: int = 0
const _PREPARE_RUNNING: int = 1
const _PREPARE_READY: int = 2
const _PREPARE_FAILED: int = 3

const _TAG: String = "MessageCore"
## `InputBlockCore` reason tag of the black box block.
const _REASON_TAG: String = "message"
const _KIND_STATE := preload("res://core/message_core/message_kind_state.gd")
const _CORE_NODE := preload("res://core/message_core/message_core_node.gd")

static var _is_initialized: bool = false
## Session of this init. An async operation that resumes in another session ends with its failure value.
static var _session: RefCounted = null
static var _node: Node = null
static var _prepare_state: int = _PREPARE_NONE

static var _toast_resource: String = ""
static var _black_box_resource: String = ""
static var _dim_opacity: float = 0.0
static var _block_max_duration_ms: int = 0
## False when `_read_settings` found a missing key or a value of the wrong type.
static var _settings_ok: bool = true

static var _toast: _KIND_STATE = null
static var _black_box: _KIND_STATE = null
## Holders of the message objects in the `Message` layer. The toast holder is drawn above the black box holder. Each
## covers the visible game area.
static var _toast_holder: Control = null
static var _black_box_holder: Control = null

## Global scope that holds the resources loaded by `prepare`.
static var _scope: Scope = null
## Toast prefab. `null` when the toast is the code made one.
static var _toast_prefab: PackedScene = null
## Black box prefab. `null` when the black box is the code made one.
static var _black_box_prefab: PackedScene = null
## The one black box object, its text element and the one code made toast object with its text element.
static var _black_box_object: Control = null
static var _black_box_label: Label = null
static var _code_toast_object: Control = null
static var _code_toast_label: Label = null
## Pass list of the black box block: the system popup root of `UICore.get_block_pass_list`, no action.
static var _pass_list: BlockPassList = null
static var _tween_options: TweenOptions = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	_toast = _KIND_STATE.new()
	_toast.is_toast = true
	_black_box = _KIND_STATE.new()
	if not _read_settings():
		_reset_state()
		return false
	var layer: Node = UICore.get_layer(UICore.UILayer.MESSAGE)
	if layer == null:
		LogCore.log_error(_TAG, "UICore gave no Message layer")
		_reset_state()
		return false
	_session = RefCounted.new()
	_black_box_holder = _make_holder(layer)
	_toast_holder = _make_holder(layer)
	_tween_options = TweenOptions.new()
	_node = _CORE_NODE.new()
	(Engine.get_main_loop() as SceneTree).root.add_child(_node)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: Node = _node
	_clean_up(true)
	if is_instance_valid(node):
		(node as _CORE_NODE).released = true
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## Loads the message resources and tween presets into the global scope and makes the message objects. Async.
static func prepare() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "prepare called before init")
		return false
	if _prepare_state == _PREPARE_RUNNING:
		LogCore.log_error(_TAG, "prepare called while a prepare is in progress")
		return false
	var session: RefCounted = _session
	if _prepare_state != _PREPARE_NONE:
		_close_kind(_toast)
		_close_kind(_black_box)
		_destroy_views(true)
	_prepare_state = _PREPARE_RUNNING
	if not _read_settings():
		_prepare_state = _PREPARE_FAILED
		return false
	var ok: bool = await _load_all(session)
	if session != _session:
		return false
	if ok:
		_prepare_state = _PREPARE_READY
	else:
		_destroy_views(true)
		_prepare_state = _PREPARE_FAILED
	return ok


static func show_toast(translation_key: String, args: FormatArgs = null, extra_text: String = "") -> void:
	_request(_toast, translation_key, args, extra_text)


static func show_black_box(translation_key: String, args: FormatArgs = null, extra_text: String = "") -> void:
	_request(_black_box, translation_key, args, extra_text)


static func close_black_box() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "close_black_box called before init")
		return
	_close_kind(_black_box)


static func close_all() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "close_all called before init")
		return
	_close_kind(_toast)
	_close_kind(_black_box)


## Every frame: keeps the holders on the visible game area and moves each kind's message on screen to its next display
## step when that step is done.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	if ResolutionCore.is_initialized():
		_fit_holders(ResolutionCore.get_visible_game_area())
	_advance(_black_box)
	_advance(_toast)


## Clean-up when the core node leaves the tree outside `release`: app exit and tree teardown.
static func _on_node_exit() -> void:
	if _is_initialized:
		_clean_up(false)


static func _request(state: _KIND_STATE, translation_key: String, args: FormatArgs, extra_text: String) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "message requested before init")
		return
	if _prepare_state != _PREPARE_READY:
		LogCore.log_error(_TAG, "message requested before prepare succeeded")
		return
	if translation_key == "":
		LogCore.log_error(_TAG, "message requested without a translation key")
		return
	var text: String = ""
	if args == null:
		text = LocalizationCore.get_text(translation_key)
	else:
		text = LocalizationCore.format(translation_key, args)
	if text == "":
		LogCore.log_error(_TAG, "message text of %s is empty" % translation_key)
		return
	if extra_text != "":
		text += "\n" + extra_text
	if state.is_toast and state.has_text(text):
		return
	if state.head > 0 and state.head == state.queue.size():
		state.queue.clear()
		state.head = 0
	state.queue.append(text)
	_show_next(state)


## Shows waiting messages until one is on screen or none waits. A message that fails at step 1 is dropped.
static func _show_next(state: _KIND_STATE) -> void:
	while state.phase == _KIND_STATE.Phase.IDLE and state.head < state.queue.size():
		var text: String = state.queue[state.head]
		state.queue[state.head] = ""
		state.head += 1
		_begin(state, text)


## Display step 1 and 2. A message that fails to show leaves nothing of it on screen.
static func _begin(state: _KIND_STATE, text: String) -> void:
	var holder: Control = _toast_holder if state.is_toast else _black_box_holder
	_fit_holders(ResolutionCore.get_visible_game_area())
	var object: Control = null
	var label: Label = null
	if state.is_toast:
		if _toast_resource != "":
			var handle: Vector4i = PoolCore.borrow(_toast_resource, _scope)
			object = PoolCore.get_instance(handle) as Control
			if object == null:
				LogCore.log_error(_TAG, "could not borrow a toast object")
				return
			state.pooled = true
			state.pool_handle = handle
			_ignore_pointer(object)
			holder.add_child(object)
			label = _find_label(object)
		else:
			if not is_instance_valid(_code_toast_object):
				_code_toast_object = _make_code_toast()
				holder.add_child(_code_toast_object)
			object = _code_toast_object
			label = _code_toast_label
	else:
		state.block_token = InputBlockCore.block(_REASON_TAG, _pass_list)
		if not InputBlockCore.is_active(state.block_token):
			state.clear_current()
			return
		state.blocked = true
		if not is_instance_valid(_black_box_object):
			_black_box_object = _make_black_box()
			if _black_box_object == null:
				_unblock(state)
				state.clear_current()
				return
			holder.add_child(_black_box_object)
		object = _black_box_object
		label = _black_box_label
	_put_back_tween_properties(state, object)
	if label != null:
		label.text = text
	object.visible = true
	state.object = object
	state.object_id = object.get_instance_id()
	state.text = text
	if state.enter_tween != "":
		state.phase = _KIND_STATE.Phase.ENTER
		state.tweening = true
		state.tween_handle = TweenCore.play_preset(state.enter_tween, _scope, object, _tween_options)
	else:
		_start_hold(state)


## Puts each holder that is not on `area` on it. The visible game area changes with the window size.
static func _fit_holders(area: Rect2) -> void:
	if is_instance_valid(_black_box_holder) and _black_box_holder.get_rect() != area:
		_black_box_holder.position = area.position
		_black_box_holder.size = area.size
	if is_instance_valid(_toast_holder) and _toast_holder.get_rect() != area:
		_toast_holder.position = area.position
		_toast_holder.size = area.size


static func _advance(state: _KIND_STATE) -> void:
	if state.phase == _KIND_STATE.Phase.IDLE:
		return
	if not is_instance_id_valid(state.object_id):
		LogCore.log_error(_TAG, "a message object was destroyed outside MessageCore while shown")
		_drop_destroyed(state)
		_show_next(state)
		return
	if state.phase == _KIND_STATE.Phase.ENTER and not TweenCore.is_playing(state.tween_handle):
		state.tweening = false
		_start_hold(state)
	if state.phase == _KIND_STATE.Phase.HOLD and TimeCore.get_real_time() >= state.hold_until_ms:
		_start_exit(state)
	if state.phase == _KIND_STATE.Phase.EXIT and (not state.tweening or not TweenCore.is_playing(state.tween_handle)):
		_lower(state)
		state.clear_current()
		_show_next(state)


## Display step 3.
static func _start_hold(state: _KIND_STATE) -> void:
	state.phase = _KIND_STATE.Phase.HOLD
	state.hold_until_ms = TimeCore.get_real_time() + state.duration_ms


## Display step 4.
static func _start_exit(state: _KIND_STATE) -> void:
	state.phase = _KIND_STATE.Phase.EXIT
	if state.exit_tween != "":
		state.tweening = true
		state.tween_handle = TweenCore.play_preset(state.exit_tween, _scope, state.object, _tween_options)
	else:
		state.tweening = false


## Display step 5 and the lowering of a kind close: takes the message object off the screen and frees the block.
static func _lower(state: _KIND_STATE) -> void:
	if state.tweening and TweenCore.is_initialized():
		TweenCore.stop(state.tween_handle)
	state.tweening = false
	if state.pooled:
		if PoolCore.is_initialized():
			PoolCore.give_back(state.pool_handle)
	elif is_instance_valid(state.object):
		state.object.visible = false
	_unblock(state)


## Display failure of a message whose object was destroyed outside MessageCore while shown.
static func _drop_destroyed(state: _KIND_STATE) -> void:
	if state.tweening and TweenCore.is_initialized():
		TweenCore.stop(state.tween_handle)
	if not state.pooled:
		if state.is_toast:
			_code_toast_object = null
			_code_toast_label = null
		else:
			_black_box_object = null
			_black_box_label = null
	_unblock(state)
	state.clear_current()


## Kind close: lowers the message on screen without its tweens and empties the queue.
static func _close_kind(state: _KIND_STATE) -> void:
	if state.phase != _KIND_STATE.Phase.IDLE:
		if is_instance_id_valid(state.object_id):
			_lower(state)
		else:
			_drop_destroyed(state)
	state.clear_current()
	state.queue.clear()
	state.head = 0


static func _unblock(state: _KIND_STATE) -> void:
	if state.blocked and InputBlockCore.is_initialized() and InputBlockCore.is_active(state.block_token):
		InputBlockCore.unblock(state.block_token)
	state.blocked = false
	state.block_token = 0


static func _put_back_tween_properties(state: _KIND_STATE, object: Control) -> void:
	object.anchor_left = state.anchors.x
	object.anchor_top = state.anchors.y
	object.anchor_right = state.anchors.z
	object.anchor_bottom = state.anchors.w
	object.offset_left = state.offsets.x
	object.offset_top = state.offsets.y
	object.offset_right = state.offsets.z
	object.offset_bottom = state.offsets.w
	object.rotation = state.rotation
	object.scale = state.scale
	object.modulate = state.modulate


static func _record_tween_properties(state: _KIND_STATE, object: Control) -> void:
	state.anchors = Vector4(object.anchor_left, object.anchor_top, object.anchor_right, object.anchor_bottom)
	state.offsets = Vector4(object.offset_left, object.offset_top, object.offset_right, object.offset_bottom)
	state.rotation = object.rotation
	state.scale = object.scale
	state.modulate = object.modulate


static func _load_all(session: RefCounted) -> bool:
	_scope = ResourceCore.get_global_scope()
	var source: BlockPassList = UICore.get_block_pass_list()
	_pass_list = BlockPassList.new()
	if source != null:
		_pass_list.elements.assign(source.elements)
	var prefab_kind: int = ResourceCore.BaseKind.PACKED_SCENE
	if _toast_resource != "":
		var toast: Resource = await ResourceCore.load(_toast_resource, prefab_kind, _scope)
		if session != _session:
			return false
		_toast_prefab = toast as PackedScene
	if _black_box_resource != "":
		var black_box: Resource = await ResourceCore.load(_black_box_resource, prefab_kind, _scope)
		if session != _session:
			return false
		_black_box_prefab = black_box as PackedScene
	var lengths: PackedInt64Array = PackedInt64Array()
	var keys: PackedStringArray = PackedStringArray([
		_toast.enter_tween, _toast.exit_tween, _black_box.enter_tween, _black_box.exit_tween
	])
	for key: String in keys:
		var length: int = await _load_preset(key, session)
		if length < 0:
			return false
		lengths.append(length)
	var black_box_ms: int = lengths[2] + _black_box.duration_ms + lengths[3]
	if black_box_ms >= _block_max_duration_ms:
		LogCore.log_error(_TAG, "black box enter tween, display time and exit tween take %d ms" % black_box_ms
				+ ", not less than InputBlockCore.maxDurationMs %d ms" % _block_max_duration_ms)
	_black_box_object = _make_black_box()
	if _black_box_object == null:
		return false
	_black_box_object.visible = false
	_black_box_holder.add_child(_black_box_object)
	_record_tween_properties(_black_box, _black_box_object)
	if _toast_resource == "":
		_code_toast_object = _make_code_toast()
		_code_toast_object.visible = false
		_toast_holder.add_child(_code_toast_object)
		_record_tween_properties(_toast, _code_toast_object)
		return true
	return await _prepare_toast_pool(session)


## Fills the toast pool and checks the toast prefab on one borrowed toast object.
static func _prepare_toast_pool(session: RefCounted) -> bool:
	var item: PrefillItem = PrefillItem.new()
	item.resource_key = _toast_resource
	item.pool_scope = _scope
	var items: Array[PrefillItem] = [item]
	var filled: bool = await PoolCore.prefill(items)
	if session != _session:
		return false
	if not filled:
		LogCore.log_error(_TAG, "toast pool prefill of %s failed" % _toast_resource)
		return false
	var handle: Vector4i = PoolCore.borrow(_toast_resource, _scope)
	var object: Control = PoolCore.get_instance(handle) as Control
	if object == null:
		LogCore.log_error(_TAG, "toast prefab %s has no Control root" % _toast_resource)
		if PoolCore.is_valid(handle):
			PoolCore.give_back(handle)
		return false
	var ok: bool = _check_view(object, true)
	if ok:
		_record_tween_properties(_toast, object)
	PoolCore.give_back(handle)
	return ok


## Loads a tween preset. Its length in ms, or -1 when it did not load, repeats forever or the session changed. An
## empty key is 0.
static func _load_preset(key: String, session: RefCounted) -> int:
	if key == "":
		return 0
	var kind: int = TweenCore.get_preset_kind()
	var resource: Resource = await ResourceCore.load(key, kind, _scope)
	if session != _session:
		return -1
	var definition: TweenDefinition = resource as TweenDefinition
	if definition == null or not ResourceCore.is_loaded(key, kind):
		LogCore.log_error(_TAG, "tween preset %s did not load" % key)
		return -1
	if definition.repeat_count == 0:
		LogCore.log_error(_TAG, "tween preset %s repeats forever" % key)
		return -1
	return _cycle_ms(definition) * definition.repeat_count


## `TweenCore` cycle time: per step the largest delay + duration of its changes, summed over the steps.
static func _cycle_ms(definition: TweenDefinition) -> int:
	var total: int = 0
	for step: TweenStep in definition.steps:
		if step == null:
			continue
		var longest: int = 0
		for change: TweenChange in step.changes:
			if change != null:
				longest = maxi(longest, change.delay + change.duration)
		total += longest
	return total


## The black box object from the prefab, or the code made one. `null` when the prefab fails the view check.
static func _make_black_box() -> Control:
	if _black_box_prefab == null and _black_box_resource == "":
		return _make_code_black_box()
	var node: Node = _black_box_prefab.instantiate() if _black_box_prefab != null else null
	var object: Control = node as Control
	if object == null:
		LogCore.log_error(_TAG, "black box prefab has no Control root")
		if node != null:
			node.free()
		return null
	if not _check_view(object, false):
		object.free()
		return null
	_black_box_label = _find_label(object)
	_ignore_pointer(object)
	return object


## True when the prefab root has a `MessageView` with a text element. Logs the missing part otherwise.
static func _check_view(object: Control, is_toast: bool) -> bool:
	var view: MessageView = _find_view(object)
	if view == null:
		if is_toast:
			LogCore.log_error(_TAG, "toast prefab has no MessageView on its root")
		else:
			LogCore.log_error(_TAG, "black box prefab has no MessageView on its root")
		return false
	if view.text_label == null:
		if is_toast:
			LogCore.log_error(_TAG, "MessageView of the toast prefab has no text element")
		else:
			LogCore.log_error(_TAG, "MessageView of the black box prefab has no text element")
		return false
	return true


static func _find_view(object: Node) -> MessageView:
	for i: int in object.get_child_count():
		var view: MessageView = object.get_child(i) as MessageView
		if view != null:
			return view
	return null


static func _find_label(object: Node) -> Label:
	var view: MessageView = _find_view(object)
	return view.text_label if view != null else null


## Message objects do not take pointer input: the UI under a toast takes it as if the toast were not there.
static func _ignore_pointer(node: Node) -> void:
	var control: Control = node as Control
	if control != null:
		control.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i: int in node.get_child_count():
		_ignore_pointer(node.get_child(i))


## Code made toast: white text on a black band whose opacity is `UICore.dimOpacity`, across the visible game area.
static func _make_code_toast() -> Control:
	var root: Control = _make_full_rect()
	var band: PanelContainer = PanelContainer.new()
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(0.0, 0.0, 0.0, _dim_opacity)
	band.add_theme_stylebox_override("panel", style)
	band.anchor_left = 0.0
	band.anchor_right = 1.0
	band.anchor_top = 0.5
	band.anchor_bottom = 0.5
	band.grow_vertical = Control.GROW_DIRECTION_BOTH
	band.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var label: Label = _make_label()
	band.add_child(label)
	root.add_child(band)
	_code_toast_label = label
	return root


## Code made black box: white text on a black dim whose opacity is `UICore.dimOpacity`, over the visible game area.
static func _make_code_black_box() -> Control:
	var root: Control = _make_full_rect()
	var dim: ColorRect = ColorRect.new()
	dim.color = Color(0.0, 0.0, 0.0, _dim_opacity)
	dim.anchor_right = 1.0
	dim.anchor_bottom = 1.0
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(dim)
	var label: Label = _make_label()
	label.anchor_right = 1.0
	label.anchor_bottom = 1.0
	root.add_child(label)
	_black_box_label = label
	return root


static func _make_full_rect() -> Control:
	var root: Control = Control.new()
	root.anchor_right = 1.0
	root.anchor_bottom = 1.0
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return root


static func _make_label() -> Label:
	var label: Label = Label.new()
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_font_size_override("font_size", ThemeDB.fallback_font_size)
	return label


static func _make_holder(layer: Node) -> Control:
	var holder: Control = Control.new()
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(holder)
	return holder


## Destroys the black box object and the code made toast object. Pooled toast objects stay with `PoolCore`.
## `immediate` frees them now; app exit queues the free because the tree is coming down.
static func _destroy_views(immediate: bool) -> void:
	if is_instance_valid(_black_box_object):
		_free_node(_black_box_object, immediate)
	if is_instance_valid(_code_toast_object):
		_free_node(_code_toast_object, immediate)
	_black_box_object = null
	_black_box_label = null
	_code_toast_object = null
	_code_toast_label = null
	_toast_prefab = null
	_black_box_prefab = null


## `release` and app exit: closes both kinds, gives back the borrowed toast object, destroys the message objects and
## the holders, and puts every static var back to its initial value.
static func _clean_up(immediate: bool) -> void:
	_close_kind(_toast)
	_close_kind(_black_box)
	_destroy_views(immediate)
	if is_instance_valid(_toast_holder):
		_free_node(_toast_holder, immediate)
	if is_instance_valid(_black_box_holder):
		_free_node(_black_box_holder, immediate)
	_reset_state()


## Frees a valid node. The caller checks `is_instance_valid` first: a freed object cannot be passed as a typed argument.
static func _free_node(node: Node, immediate: bool) -> void:
	if immediate:
		node.free()
	else:
		node.queue_free()


static func _reset_state() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_prepare_state = _PREPARE_NONE
	_toast_resource = ""
	_black_box_resource = ""
	_dim_opacity = 0.0
	_block_max_duration_ms = 0
	_settings_ok = true
	_toast = null
	_black_box = null
	_toast_holder = null
	_black_box_holder = null
	_scope = null
	_toast_prefab = null
	_black_box_prefab = null
	_black_box_object = null
	_black_box_label = null
	_code_toast_object = null
	_code_toast_label = null
	_pass_list = null
	_tween_options = null


## Reads the settings of the module spec `## settings`. False when a key is missing or has the wrong type.
static func _read_settings() -> bool:
	_settings_ok = true
	_toast_resource = _read_string("MessageCore.toastResource")
	_black_box_resource = _read_string("MessageCore.blackBoxResource")
	_toast.duration_ms = _read_int("MessageCore.toastDurationMs")
	_black_box.duration_ms = _read_int("MessageCore.blackBoxDurationMs")
	_toast.enter_tween = _read_string("MessageCore.toastEnterTween")
	_toast.exit_tween = _read_string("MessageCore.toastExitTween")
	_black_box.enter_tween = _read_string("MessageCore.blackBoxEnterTween")
	_black_box.exit_tween = _read_string("MessageCore.blackBoxExitTween")
	_dim_opacity = _read_float("UICore.dimOpacity")
	_block_max_duration_ms = _read_int("InputBlockCore.maxDurationMs")
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


static func _read_float(key: String) -> float:
	if not CoreSettings.has_float(key):
		_setting_missing(key)
		return 0.0
	return CoreSettings.get_float(key)


static func _setting_missing(key: String) -> void:
	LogCore.log_error(_TAG, "core setting %s is missing or has the wrong type" % key)
	_settings_ok = false
