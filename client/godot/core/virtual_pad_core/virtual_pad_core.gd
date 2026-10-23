class_name VirtualPadCore
extends RefCounted
## Draws the virtual joystick and the virtual buttons of a layout prefab on the `VirtualPad` UI layer and turns their
## pointers into `InputCore` action injects. Keeps the element layout the user changed in the device file. The
## elements are engine GUI controls: while the virtual pad is `ACTIVE` they stop the pointer input on them, so a
## pointer pressed in an element area is consumed at the `InputCore` UI stage. Outside `ACTIVE` they ignore pointers.

## `ACTIVE` draws and takes pointers, `INACTIVE` draws without taking pointers, `HIDDEN` neither draws nor takes them.
enum VirtualPadState { ACTIVE, INACTIVE, HIDDEN }
## Where the joystick base is: `FIXED` stays at its default position, `FLOATING` moves to the pressed point,
## `FOLLOWING` moves to the pressed point and follows a pointer that goes beyond the base radius.
enum JoystickMode { FIXED, FLOATING, FOLLOWING }

const _NODE_SCRIPT := preload("res://core/virtual_pad_core/virtual_pad_core_node.gd")
const _ELEMENT := preload("res://core/virtual_pad_core/virtual_pad_element.gd")
const _WAITER := preload("res://core/virtual_pad_core/virtual_pad_waiter.gd")

const _TAG: String = "VirtualPadCore"
const _SETTING_DEAD_ZONE: String = "VirtualPadCore.deadZonePermille"
const _SETTING_SENSITIVITY: String = "VirtualPadCore.sensitivityPermille"
## `LocalDataCore` keys of the user settings in the device file. The i-th value of the other four is the value of the
## i-th name of `_KEY_NAMES`.
const _KEY_NAMES: String = "VirtualPadCore.element_names"
const _KEY_OFFSET_X: String = "VirtualPadCore.offset_x"
const _KEY_OFFSET_Y: String = "VirtualPadCore.offset_y"
const _KEY_SCALE: String = "VirtualPadCore.scale"
const _KEY_OPACITY: String = "VirtualPadCore.opacity"
const _DEVICE: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
## The user setting a set operation changed.
const _SET_OFFSET: int = 0
const _SET_SCALE: int = 1
const _SET_OPACITY: int = 2
const _LOWER_A: int = 97
const _LOWER_Z: int = 122
const _DIGIT_0: int = 48
const _DIGIT_9: int = 57
const _UNDERSCORE: int = 95

static var _is_initialized: bool = false
static var _node: Node = null
## Replaced on every `init`; an `open_layout` that finds another session after `await` gives `false`.
static var _session: RefCounted = null
## The safe area root of the `VirtualPad` layer. The virtual pad goes under it.
static var _safe_root: SafeAreaRoot = null
static var _scope_listener: Callable = Callable()
## D and S of the direction value.
static var _dead_zone: float = 0.0
static var _sensitivity: float = 1.0
## Decided in `init`; `VirtualPadCoreDev.set_test_touch_support` sets it.
static var _touch_supported: bool = false
static var _state: VirtualPadState = VirtualPadState.HIDDEN
## The load of the `open_layout` that waits, or `null`. Only this load makes a virtual pad.
static var _waiter: _WAITER = null
## Counts `open_layout` and `close_layout` calls. An abandoned `open_layout` resumes inside the call that abandons it,
## and its caller can call `open_layout` or `close_layout` again before that call goes on; the call that finds a later
## one stops there: `open_layout` gives `false`, `close_layout` leaves the virtual pad of the later call.
static var _open_count: int = 0
## The virtual pad: the layout prefab instance, or `null`.
static var _pad: VirtualPadLayout = null
static var _pad_key: String = ""
static var _pad_scope: Scope = null
static var _joystick_mode: JoystickMode = JoystickMode.FIXED
## Elements of the virtual pad in element list order: the last one is drawn on top.
static var _elements: Array[_ELEMENT] = []
## `InputCore.get_cancel_count` when it was last seen.
static var _cancel_count: int = 0
## Whether `UICore.get_open_popup_count` was 1 or more when it was last seen.
static var _has_popup: bool = false
## The saved user settings as `_load_saved` read them.
static var _saved_names: PackedStringArray = PackedStringArray()
static var _saved_offset_x: PackedFloat64Array = PackedFloat64Array()
static var _saved_offset_y: PackedFloat64Array = PackedFloat64Array()
static var _saved_scale: PackedFloat64Array = PackedFloat64Array()
static var _saved_opacity: PackedFloat64Array = PackedFloat64Array()


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_SETTING_DEAD_ZONE) or not CoreSettings.has_int(_SETTING_SENSITIVITY):
		LogCore.log_error(_TAG, "init: core settings key %s or %s is missing or not an integer"
			% [_SETTING_DEAD_ZONE, _SETTING_SENSITIVITY])
		return false
	var layer: CanvasLayer = UICore.get_layer(UICore.UILayer.VIRTUAL_PAD)
	if layer == null:
		LogCore.log_error(_TAG, "init: there is no VirtualPad UI layer")
		return false
	var dead_zone: int = CoreSettings.get_int(_SETTING_DEAD_ZONE)
	if dead_zone < 0 or dead_zone > 999:
		LogCore.log_error(_TAG, "init: %s %d is out of 0 to 999; the dead zone is 0" % [_SETTING_DEAD_ZONE, dead_zone])
		_dead_zone = 0.0
	else:
		_dead_zone = dead_zone / 1000.0
	var sensitivity: int = CoreSettings.get_int(_SETTING_SENSITIVITY)
	if sensitivity <= 0:
		LogCore.log_error(_TAG, "init: %s %d is not above 0; the sensitivity is 1" % [_SETTING_SENSITIVITY, sensitivity])
		_sensitivity = 1.0
	else:
		_sensitivity = sensitivity / 1000.0
	_touch_supported = DisplayServer.is_touchscreen_available()
	_session = RefCounted.new()
	var node: _NODE_SCRIPT = _NODE_SCRIPT.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_node = node
	var safe_root: SafeAreaRoot = SafeAreaRoot.new()
	safe_root.name = "SafeAreaRoot"
	layer.add_child(safe_root)
	_safe_root = safe_root
	if not EventCore.subscribe(InputDeviceChangedEvent, node._on_device_changed) \
			or not EventCore.subscribe(SafeAreaChangedEvent, node._on_safe_area_changed):
		LogCore.log_error(_TAG, "init: an event subscription failed")
		_cleanup(true)
		return false
	_scope_listener = VirtualPadCore._on_scope_released
	ResourceCore.add_scope_release_listener(_scope_listener)
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized and _node == null:
		return
	_cleanup(true)


static func is_initialized() -> bool:
	return _is_initialized


## Async. Loads the layout prefab `resource_key` with `scope` from `ResourceCore`, makes the virtual pad from it and
## applies the user settings. `true` when it made the virtual pad, or when the virtual pad already is that key and
## scope.
static func open_layout(resource_key: String, scope: Scope) -> bool:
	if not _check_initialized("open_layout"):
		return false
	_open_count += 1
	var request: int = _open_count
	_abandon_waiter()
	if request != _open_count:
		return false
	if _pad != null and resource_key == _pad_key and scope == _pad_scope:
		return true
	_close()
	var waiter: _WAITER = _WAITER.new()
	waiter.scope = scope
	_waiter = waiter
	var session: RefCounted = _session
	waiter.start_load(resource_key, scope)
	if not waiter.finished and not waiter.cancelled:
		await waiter.done
	if session != _session or _waiter != waiter:
		return false
	_waiter = null
	var scene: PackedScene = waiter.resource as PackedScene
	if scene == null or not ResourceCore.is_loaded(resource_key, ResourceCore.BaseKind.PACKED_SCENE):
		LogCore.log_error(_TAG, "open_layout: %s is not a layout prefab: the fallback resource" % resource_key)
		return false
	return _make_pad(resource_key, scope, scene)


## Does the release handling and removes the virtual pad. Abandons the `open_layout` that waits.
static func close_layout() -> void:
	if not _check_initialized("close_layout"):
		return
	_open_count += 1
	var request: int = _open_count
	_abandon_waiter()
	if request != _open_count:
		return
	_close()


## Moves the element `element_name` by `offset` (game coordinates) from its place in the layout, and saves it.
static func set_offset(element_name: String, offset: Vector2) -> void:
	if not _check_initialized("set_offset"):
		return
	var element: _ELEMENT = _find_element("set_offset", element_name)
	if element == null:
		return
	if not offset.is_finite():
		LogCore.log_error(_TAG, "set_offset: the offset of %s is not finite" % element_name)
		return
	element.offset = offset
	_place(element)
	_save(element, _SET_OFFSET)


## Scales the element `element_name` by `scale` around its area center, and saves it. `scale` is above 0.
static func set_scale(element_name: String, scale: float) -> void:
	if not _check_initialized("set_scale"):
		return
	var element: _ELEMENT = _find_element("set_scale", element_name)
	if element == null:
		return
	if not is_finite(scale) or scale <= 0.0:
		LogCore.log_error(_TAG, "set_scale: the scale %s of %s is not above 0" % [scale, element_name])
		return
	element.scale = scale
	_place(element)
	_save(element, _SET_SCALE)


## Multiplies the picture alpha of the element `element_name` by `opacity` (0 to 1), and saves it.
static func set_opacity(element_name: String, opacity: float) -> void:
	if not _check_initialized("set_opacity"):
		return
	var element: _ELEMENT = _find_element("set_opacity", element_name)
	if element == null:
		return
	if is_nan(opacity):
		LogCore.log_error(_TAG, "set_opacity: the opacity of %s is NaN" % element_name)
		return
	var value: float = opacity
	if value < 0.0 or value > 1.0:
		LogCore.log_error(_TAG, "set_opacity: the opacity %s of %s is out of 0 to 1" % [opacity, element_name])
		value = clampf(value, 0.0, 1.0)
	element.opacity = value
	_place(element)
	_save(element, _SET_OPACITY)


## The offset of the element `element_name` before it is moved into the safe area.
static func get_offset(element_name: String) -> Vector2:
	if not _check_initialized("get_offset"):
		return Vector2.ZERO
	var element: _ELEMENT = _find_element("get_offset", element_name)
	return element.offset if element != null else Vector2.ZERO


static func get_scale(element_name: String) -> float:
	if not _check_initialized("get_scale"):
		return 1.0
	var element: _ELEMENT = _find_element("get_scale", element_name)
	return element.scale if element != null else 1.0


static func get_opacity(element_name: String) -> float:
	if not _check_initialized("get_opacity"):
		return 1.0
	var element: _ELEMENT = _find_element("get_opacity", element_name)
	return element.opacity if element != null else 1.0


## Removes the saved user settings and puts the defaults on every element of the virtual pad.
static func reset_user_settings() -> void:
	if not _check_initialized("reset_user_settings"):
		return
	LocalDataCore.remove_value(_DEVICE, _KEY_NAMES)
	LocalDataCore.remove_value(_DEVICE, _KEY_OFFSET_X)
	LocalDataCore.remove_value(_DEVICE, _KEY_OFFSET_Y)
	LocalDataCore.remove_value(_DEVICE, _KEY_SCALE)
	LocalDataCore.remove_value(_DEVICE, _KEY_OPACITY)
	for element: _ELEMENT in _elements:
		element.offset = Vector2.ZERO
		element.scale = 1.0
		element.opacity = 1.0
		_place(element)


## The state of the virtual pad; `HIDDEN` when there is none.
static func get_state() -> VirtualPadState:
	if not _check_initialized("get_state"):
		return VirtualPadState.HIDDEN
	return _state


# --- virtual pad


static func _make_pad(resource_key: String, scope: Scope, scene: PackedScene) -> bool:
	var instance: Node = scene.instantiate()
	var layout: VirtualPadLayout = instance as VirtualPadLayout
	if layout == null:
		LogCore.log_error(_TAG, "open_layout: %s is not a layout prefab: the root is not a VirtualPadLayout"
			% resource_key)
		if instance != null:
			instance.free()
		return false
	var elements: Array[_ELEMENT] = []
	var reason: String = _read_layout(layout, elements)
	if not reason.is_empty():
		LogCore.log_error(_TAG, "open_layout: %s is not a layout prefab: %s" % [resource_key, reason])
		layout.free()
		return false
	layout.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layout.focus_mode = Control.FOCUS_NONE
	for element: _ELEMENT in elements:
		element.control.focus_mode = Control.FOCUS_NONE
		_ignore_pointers_below(element.control)
	_safe_root.add_child(layout)
	layout.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_pad = layout
	_pad_key = resource_key
	_pad_scope = scope
	_joystick_mode = layout.joystick_mode
	_elements = elements
	_load_saved()
	for element: _ELEMENT in _elements:
		_apply_saved(element)
		_place(element)
	_cancel_count = InputCore.get_cancel_count()
	_state = VirtualPadState.HIDDEN
	_update_state()
	_apply_state()
	return true


## Reads the elements of `layout` into `elements`. The reason it is not a layout prefab, or an empty string.
static func _read_layout(layout: VirtualPadLayout, elements: Array[_ELEMENT]) -> String:
	var mode: int = layout.joystick_mode
	if mode != JoystickMode.FIXED and mode != JoystickMode.FLOATING and mode != JoystickMode.FOLLOWING:
		return "the joystick mode %d is not a JoystickMode" % mode
	var parent_size: Vector2 = _safe_root.size
	var names: Dictionary[String, bool] = {}
	for child: Node in layout.get_children():
		var joystick: VirtualPadJoystick = child as VirtualPadJoystick
		var button: VirtualButton = child as VirtualButton
		if joystick == null and button == null:
			return "the child %s is not a VirtualPadJoystick or a VirtualButton" % child.name
		var control: Control = child as Control
		var element_name: String = String(child.name)
		if element_name.is_empty():
			return "an element name is empty"
		if not _is_snake_case(element_name):
			return "the element name %s is not snake_case" % element_name
		if names.has(element_name):
			return "the element name %s repeats" % element_name
		names[element_name] = true
		var element: _ELEMENT = _ELEMENT.new()
		element.control = control
		element.element_name = element_name
		element.anchors = Vector4(control.anchor_left, control.anchor_top, control.anchor_right, control.anchor_bottom)
		element.offsets = Vector4(control.offset_left, control.offset_top, control.offset_right, control.offset_bottom)
		var size: Vector2 = _layout_rect(element, parent_size).size
		if button != null:
			if not InputCore.has_action(button.action):
				return "the action %s of %s is not in the action list" % [button.action, element_name]
			element.action = button.action
		else:
			element.is_joystick = true
			var actions: Array[StringName] = [
				joystick.action_negative_x, joystick.action_positive_x, joystick.action_negative_y,
				joystick.action_positive_y,
			]
			for action: StringName in actions:
				if not InputCore.has_action(action):
					return "the direction action %s of %s is not in the action list" % [action, element_name]
			element.actions = actions
			if not is_finite(joystick.base_radius) or joystick.base_radius <= 0.0:
				return "the base radius of %s is not above 0" % element_name
			var base_position: Vector2 = joystick.base_position
			if not base_position.is_finite() or base_position.x < 0.0 or base_position.y < 0.0 \
					or base_position.x > size.x or base_position.y > size.y:
				return "the base position of %s is not in its element area" % element_name
			if joystick.base == null or not control.is_ancestor_of(joystick.base):
				return "the base of %s is not a node below it" % element_name
			if joystick.handle == null or not control.is_ancestor_of(joystick.handle):
				return "the handle of %s is not a node below it" % element_name
			element.base_control = joystick.base
			element.handle_control = joystick.handle
			element.base_default = base_position
			element.base_radius = joystick.base_radius
			element.base_center = base_position
		elements.append(element)
	return ""


## Release handling of every element, then the virtual pad goes. Nothing without a virtual pad.
static func _close() -> void:
	if _pad == null:
		return
	_release_all()
	var pad: VirtualPadLayout = _pad
	if is_instance_valid(pad):
		if pad.get_parent() != null:
			pad.get_parent().remove_child(pad)
		pad.queue_free()
	_pad = null
	_pad_key = ""
	_pad_scope = null
	_joystick_mode = JoystickMode.FIXED
	_elements = []
	_state = VirtualPadState.HIDDEN


## Ends the `open_layout` that waits with `false`. Its load result makes no virtual pad.
static func _abandon_waiter() -> void:
	if _waiter == null:
		return
	var waiter: _WAITER = _waiter
	_waiter = null
	waiter.cancel()


## A resource scope is released: the virtual pad of that scope closes, the wait of that scope ends with `false`.
static func _on_scope_released(scope: Scope) -> void:
	if not _is_initialized or scope == null:
		return
	if _waiter != null and _waiter.scope == scope:
		_abandon_waiter()
	if _pad != null and _pad_scope == scope:
		_abandon_waiter()
		_close()


# --- state


## Decides the state again from the touch support, the input device and the open popup count.
static func _update_state() -> void:
	if _pad == null:
		_set_state(VirtualPadState.HIDDEN)
		return
	_has_popup = UICore.get_open_popup_count() >= 1
	if not _touch_supported or InputCore.get_device() != InputCore.InputDevice.TOUCH:
		_set_state(VirtualPadState.HIDDEN)
	elif _has_popup:
		_set_state(VirtualPadState.INACTIVE)
	else:
		_set_state(VirtualPadState.ACTIVE)


static func _set_state(state: VirtualPadState) -> void:
	if state == _state:
		return
	if _state == VirtualPadState.ACTIVE:
		_release_all()
	_state = state
	_apply_state()


## Draws the virtual pad unless `HIDDEN`; its elements stop pointers only while `ACTIVE`.
static func _apply_state() -> void:
	if _pad == null:
		return
	_pad.visible = _state != VirtualPadState.HIDDEN
	var mouse_filter: Control.MouseFilter = Control.MOUSE_FILTER_STOP if _state == VirtualPadState.ACTIVE \
		else Control.MOUSE_FILTER_IGNORE
	for element: _ELEMENT in _elements:
		element.control.mouse_filter = mouse_filter


static func _on_frame() -> void:
	if not _is_initialized or _pad == null:
		return
	_check_cancel()
	if (UICore.get_open_popup_count() >= 1) != _has_popup:
		_update_state()


static func _on_device_changed() -> void:
	if _is_initialized and _pad != null:
		_update_state()


static func _on_safe_area_changed() -> void:
	if not _is_initialized or _pad == null:
		return
	_release_all()
	for element: _ELEMENT in _elements:
		_place(element)


## An input cancel since the last look: release handling of every element.
static func _check_cancel() -> void:
	var count: int = InputCore.get_cancel_count()
	if count == _cancel_count:
		return
	_cancel_count = count
	_release_all()


# --- pointers


## GUI input of an element (`VirtualPadJoystick`, `VirtualButton`). Frame code.
static func _on_element_input(control: Control, event: InputEvent) -> void:
	if not _is_initialized or _pad == null or _state != VirtualPadState.ACTIVE:
		return
	_check_cancel()
	var element: _ELEMENT = _element_of(control)
	if element == null:
		return
	var touch: InputEventScreenTouch = event as InputEventScreenTouch
	if touch != null:
		if touch.pressed:
			_press(element, touch.index, touch.position)
		elif element.pointer_id == touch.index:
			_release_element(element)
		return
	var drag: InputEventScreenDrag = event as InputEventScreenDrag
	if drag != null and element.pointer_id == drag.index:
		_move(element, drag.position)


## A pointer pressed in the area of `element` at `position` (element local). The element takes it unless it has one.
static func _press(element: _ELEMENT, pointer_id: int, position: Vector2) -> void:
	# A pointer ID an element still has was lifted without a release that reached it.
	for other: _ELEMENT in _elements:
		if other.pointer_id == pointer_id:
			_release_element(other)
	if element.pointer_id >= 0:
		return
	element.pointer_id = pointer_id
	if not element.is_joystick:
		InputCore.inject_action(element.action, true, 1.0, pointer_id)
		return
	element.pointer = position
	element.base_center = element.base_default if _joystick_mode == JoystickMode.FIXED else position
	_update_joystick(element)


static func _move(element: _ELEMENT, position: Vector2) -> void:
	if not element.is_joystick:
		return
	element.pointer = position
	if _joystick_mode == JoystickMode.FOLLOWING:
		var delta: Vector2 = position - element.base_center
		var distance: float = delta.length()
		if distance > element.base_radius:
			element.base_center = position - delta / distance * element.base_radius
	_update_joystick(element)


## Release handling of every element that has a pointer.
static func _release_all() -> void:
	for element: _ELEMENT in _elements:
		if element.pointer_id >= 0:
			_release_element(element)


## The element lets its pointer go: a button injects the release, a joystick injects (0, 0) and puts its base at the
## default position.
static func _release_element(element: _ELEMENT) -> void:
	var pointer_id: int = element.pointer_id
	element.pointer_id = -1
	var can_inject: bool = InputCore.is_initialized()
	if not element.is_joystick:
		if can_inject:
			InputCore.inject_action(element.action, false, 0.0, pointer_id)
		return
	if can_inject:
		_inject_direction(element, Vector2.ZERO, pointer_id)
	else:
		for i: int in element.strengths.size():
			element.strengths[i] = 0.0
	element.base_center = element.base_default
	_draw_joystick(element)


## Direction value of the joystick from its base and pointer, its injects, and its base and handle.
static func _update_joystick(element: _ELEMENT) -> void:
	var delta: Vector2 = element.pointer - element.base_center
	var distance: float = delta.length()
	var ratio: float = minf(distance / element.base_radius, 1.0)
	var value: Vector2 = Vector2.ZERO
	if distance > 0.0 and ratio > _dead_zone:
		var magnitude: float = minf(1.0, (ratio - _dead_zone) / (1.0 - _dead_zone) * _sensitivity)
		value = delta / distance * magnitude
	_inject_direction(element, value, element.pointer_id)
	_draw_joystick(element)


## Injects the strength of each direction action that changed.
static func _inject_direction(element: _ELEMENT, value: Vector2, pointer_id: int) -> void:
	_inject_strength(element, 0, maxf(0.0, -value.x), pointer_id)
	_inject_strength(element, 1, maxf(0.0, value.x), pointer_id)
	_inject_strength(element, 2, maxf(0.0, -value.y), pointer_id)
	_inject_strength(element, 3, maxf(0.0, value.y), pointer_id)


static func _inject_strength(element: _ELEMENT, index: int, strength: float, pointer_id: int) -> void:
	if element.strengths[index] == strength:
		return
	element.strengths[index] = strength
	InputCore.inject_action(element.actions[index], strength > 0.0, strength, pointer_id)


## Puts the base center at the base and the handle toward the pointer by (pointer distance, base radius), whichever
## is smaller; at the base center without a pointer.
static func _draw_joystick(element: _ELEMENT) -> void:
	var handle_center: Vector2 = element.base_center
	if element.pointer_id >= 0:
		var delta: Vector2 = element.pointer - element.base_center
		var distance: float = delta.length()
		if distance > 0.0:
			handle_center += delta / distance * minf(distance, element.base_radius)
	_put_center(element.base_control, element.control, element.base_center)
	_put_center(element.handle_control, element.control, handle_center)


## Moves `target` so that its center is at `point` in the local coordinates of `element`.
static func _put_center(target: Control, element: Control, point: Vector2) -> void:
	if not is_instance_valid(target):
		return
	var local: Vector2 = point
	var parent: CanvasItem = target.get_parent() as CanvasItem
	if parent != null and parent != element:
		local = parent.get_global_transform().affine_inverse() * (element.get_global_transform() * point)
	var center: Vector2 = target.get_transform() * (target.size * 0.5)
	target.position += local - center


static func _element_of(control: Control) -> _ELEMENT:
	for i: int in _elements.size():
		if _elements[i].control == control:
			return _elements[i]
	return null


# --- layout and user settings


## Rectangle of the element in the virtual pad root by its anchors and offsets of the layout prefab.
static func _layout_rect(element: _ELEMENT, parent_size: Vector2) -> Rect2:
	var top_left: Vector2 = Vector2(element.anchors.x * parent_size.x + element.offsets.x,
		element.anchors.y * parent_size.y + element.offsets.y)
	var bottom_right: Vector2 = Vector2(element.anchors.z * parent_size.x + element.offsets.z,
		element.anchors.w * parent_size.y + element.offsets.w)
	return Rect2(top_left, bottom_right - top_left)


## Places the element by the layout prefab and its user settings, moved into the safe area.
static func _place(element: _ELEMENT) -> void:
	var parent_size: Vector2 = _safe_root.size
	var rect: Rect2 = _layout_rect(element, parent_size)
	var scaled: Vector2 = rect.size * element.scale
	var center: Vector2 = rect.get_center() + element.offset
	center.x = _fit(center.x, scaled.x, parent_size.x)
	center.y = _fit(center.y, scaled.y, parent_size.y)
	var top_left: Vector2 = center - rect.size * 0.5
	var control: Control = element.control
	control.offset_left = top_left.x - element.anchors.x * parent_size.x
	control.offset_top = top_left.y - element.anchors.y * parent_size.y
	control.offset_right = top_left.x + rect.size.x - element.anchors.z * parent_size.x
	control.offset_bottom = top_left.y + rect.size.y - element.anchors.w * parent_size.y
	control.pivot_offset = rect.size * 0.5
	control.scale = Vector2(element.scale, element.scale)
	control.modulate.a = element.opacity
	if element.is_joystick:
		_draw_joystick(element)


## Center on one axis of an area of `length` inside 0 to `total`: moved in when it sticks out, the middle when it is
## longer.
static func _fit(center: float, length: float, total: float) -> float:
	if length > total:
		return total * 0.5
	return clampf(center, length * 0.5, total - length * 0.5)


## Reads the saved user settings. Arrays of different lengths or a repeated name read as five empty arrays.
static func _load_saved() -> void:
	_saved_names = LocalDataCore.get_array_string(_DEVICE, _KEY_NAMES)
	_saved_offset_x = LocalDataCore.get_array_float(_DEVICE, _KEY_OFFSET_X)
	_saved_offset_y = LocalDataCore.get_array_float(_DEVICE, _KEY_OFFSET_Y)
	_saved_scale = LocalDataCore.get_array_float(_DEVICE, _KEY_SCALE)
	_saved_opacity = LocalDataCore.get_array_float(_DEVICE, _KEY_OPACITY)
	var count: int = _saved_names.size()
	var valid: bool = _saved_offset_x.size() == count and _saved_offset_y.size() == count \
		and _saved_scale.size() == count and _saved_opacity.size() == count
	if valid:
		var seen: Dictionary[String, bool] = {}
		for saved_name: String in _saved_names:
			if seen.has(saved_name):
				valid = false
				break
			seen[saved_name] = true
	if not valid:
		_saved_names = PackedStringArray()
		_saved_offset_x = PackedFloat64Array()
		_saved_offset_y = PackedFloat64Array()
		_saved_scale = PackedFloat64Array()
		_saved_opacity = PackedFloat64Array()


## The saved user settings of the element's name; the default for a missing name and for each value out of range.
static func _apply_saved(element: _ELEMENT) -> void:
	element.offset = Vector2.ZERO
	element.scale = 1.0
	element.opacity = 1.0
	var index: int = _saved_names.find(element.element_name)
	if index < 0:
		return
	if is_finite(_saved_offset_x[index]):
		element.offset.x = _saved_offset_x[index]
	if is_finite(_saved_offset_y[index]):
		element.offset.y = _saved_offset_y[index]
	if is_finite(_saved_scale[index]) and _saved_scale[index] > 0.0:
		element.scale = _saved_scale[index]
	if _saved_opacity[index] >= 0.0 and _saved_opacity[index] <= 1.0:
		element.opacity = _saved_opacity[index]


## Saves the user setting `changed` of the element. A saved name gets only the changed keys; a new name gets an entry
## at the end of the arrays, with the defaults for the other values, and all five keys.
static func _save(element: _ELEMENT, changed: int) -> void:
	_load_saved()
	var index: int = _saved_names.find(element.element_name)
	if index >= 0:
		if changed == _SET_OFFSET:
			_saved_offset_x[index] = element.offset.x
			_saved_offset_y[index] = element.offset.y
			LocalDataCore.set_array_float(_DEVICE, _KEY_OFFSET_X, _saved_offset_x)
			LocalDataCore.set_array_float(_DEVICE, _KEY_OFFSET_Y, _saved_offset_y)
		elif changed == _SET_SCALE:
			_saved_scale[index] = element.scale
			LocalDataCore.set_array_float(_DEVICE, _KEY_SCALE, _saved_scale)
		else:
			_saved_opacity[index] = element.opacity
			LocalDataCore.set_array_float(_DEVICE, _KEY_OPACITY, _saved_opacity)
		return
	_saved_names.append(element.element_name)
	_saved_offset_x.append(element.offset.x if changed == _SET_OFFSET else 0.0)
	_saved_offset_y.append(element.offset.y if changed == _SET_OFFSET else 0.0)
	_saved_scale.append(element.scale if changed == _SET_SCALE else 1.0)
	_saved_opacity.append(element.opacity if changed == _SET_OPACITY else 1.0)
	LocalDataCore.set_array_string(_DEVICE, _KEY_NAMES, _saved_names)
	LocalDataCore.set_array_float(_DEVICE, _KEY_OFFSET_X, _saved_offset_x)
	LocalDataCore.set_array_float(_DEVICE, _KEY_OFFSET_Y, _saved_offset_y)
	LocalDataCore.set_array_float(_DEVICE, _KEY_SCALE, _saved_scale)
	LocalDataCore.set_array_float(_DEVICE, _KEY_OPACITY, _saved_opacity)


static func _find_element(operation: String, element_name: String) -> _ELEMENT:
	for element: _ELEMENT in _elements:
		if element.element_name == element_name:
			return element
	LogCore.log_error(_TAG, "%s: the virtual pad has no element %s" % [operation, element_name])
	return null


# --- helpers


## Sets every `Control` below `node` to ignore pointers, so that the element area alone takes them.
static func _ignore_pointers_below(node: Node) -> void:
	for child: Node in node.get_children():
		var control: Control = child as Control
		if control != null:
			control.mouse_filter = Control.MOUSE_FILTER_IGNORE
			control.focus_mode = Control.FOCUS_NONE
		_ignore_pointers_below(child)


## `[a-z][a-z0-9_]*` without `__` and a trailing `_`.
static func _is_snake_case(text: String) -> bool:
	var length: int = text.length()
	if length == 0:
		return false
	var first: int = text.unicode_at(0)
	if first < _LOWER_A or first > _LOWER_Z:
		return false
	var previous: int = first
	for i: int in range(1, length):
		var c: int = text.unicode_at(i)
		var is_lower: bool = c >= _LOWER_A and c <= _LOWER_Z
		var is_digit: bool = c >= _DIGIT_0 and c <= _DIGIT_9
		if not is_lower and not is_digit and c != _UNDERSCORE:
			return false
		if c == _UNDERSCORE and previous == _UNDERSCORE:
			return false
		previous = c
	return previous != _UNDERSCORE


static func _check_initialized(operation: String) -> bool:
	if _is_initialized:
		return true
	LogCore.log_error(_TAG, operation + ": not initialized")
	return false


# --- lifecycle


static func _on_node_exit_tree(node: Node) -> void:
	if node == _node:
		_cleanup(false)


## Abandons the wait, closes the virtual pad and destroys the safe area root. `remove_nodes` is false when the tree
## takes the nodes down (app exit, the core node destroyed outside `release`).
static func _cleanup(remove_nodes: bool) -> void:
	var node: Node = _node
	_node = null
	_abandon_waiter()
	if _pad != null:
		_release_all()
		if is_instance_valid(_pad):
			if remove_nodes and _pad.get_parent() != null:
				_pad.get_parent().remove_child(_pad)
			_pad.queue_free()
	if node != null and is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if remove_nodes:
			if node.get_parent() != null:
				node.get_parent().remove_child(node)
			node.queue_free()
	if not _scope_listener.is_null() and ResourceCore.is_initialized():
		ResourceCore.remove_scope_release_listener(_scope_listener)
	if _safe_root != null and is_instance_valid(_safe_root):
		if remove_nodes and _safe_root.get_parent() != null:
			_safe_root.get_parent().remove_child(_safe_root)
		_safe_root.queue_free()
	_reset_state()


## Puts every static var back to its initial value.
static func _reset_state() -> void:
	_is_initialized = false
	_node = null
	_session = null
	_safe_root = null
	_scope_listener = Callable()
	_dead_zone = 0.0
	_sensitivity = 1.0
	_touch_supported = false
	_state = VirtualPadState.HIDDEN
	_waiter = null
	_open_count = 0
	_pad = null
	_pad_key = ""
	_pad_scope = null
	_joystick_mode = JoystickMode.FIXED
	_elements = []
	_cancel_count = 0
	_has_popup = false
	_saved_names = PackedStringArray()
	_saved_offset_x = PackedFloat64Array()
	_saved_offset_y = PackedFloat64Array()
	_saved_scale = PackedFloat64Array()
	_saved_opacity = PackedFloat64Array()
