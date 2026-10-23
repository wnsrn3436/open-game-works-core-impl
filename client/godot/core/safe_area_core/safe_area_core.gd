class_name SafeAreaCore
extends RefCounted
## Computes the safe area that notches, punch holes, the home indicator and round corners do not cover, in game
## coordinates, and keeps the safe area roots and the UI elements with an ignore mark placed by it. Also tells the
## keyboard area the screen keyboard covers, in game coordinates.

## A side of the safe area for `get_inset`.
enum Edge { LEFT, TOP, RIGHT, BOTTOM }

const _TAG: String = "SafeAreaCore"
const _ROTATION_CHECK_INTERVAL_KEY: String = "SafeAreaCore.rotationCheckIntervalMs"
const _CORE_NODE := preload("res://core/safe_area_core/safe_area_core_node.gd")
const _NO_VIRTUAL_KEYBOARD: int = -1

static var _is_initialized: bool = false
## Replaced by every `init`; deferred work and a recalculation that sees another session do nothing.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
static var _rotation_check_interval_ms: int = 0
## `Time.get_ticks_msec()` value at which the next rotation check reads the OS safe area.
static var _next_rotation_check_ms: int = 0

# Result of the last calculation, in game coordinates.
static var _safe_area: Rect2 = Rect2()
static var _inset_left: float = 0.0
static var _inset_top: float = 0.0
static var _inset_right: float = 0.0
static var _inset_bottom: float = 0.0
## The visible game area the last calculation used; the ignore marks are placed by it.
static var _visible_area: Rect2 = Rect2()
## The OS safe area (window pixels) the last calculation used.
static var _os_area: Rect2 = Rect2()
static var _keyboard_area: Rect2 = Rect2()
## The OS keyboard height (window pixels) the last keyboard area calculation used.
static var _os_keyboard_height: int = 0

# Placement targets that entered the UI tree since `init`.
static var _roots: Array[SafeAreaRoot] = []
static var _ignores: Array[SafeAreaIgnore] = []

# Recalculation while `SafeAreaChangedEvent` is being published waits until the publish returns.
static var _publishing: bool = false
static var _safe_area_pending: bool = false
static var _keyboard_pending: bool = false

# DEV state. `SafeAreaCoreDev` writes it.
static var _has_virtual_notch: bool = false
## Left, top, right and bottom distances of the virtual notch, in window pixels.
static var _virtual_notch: Vector4i = Vector4i.ZERO
## Height of the virtual keyboard in window pixels, or `_NO_VIRTUAL_KEYBOARD`.
static var _virtual_keyboard_height: int = _NO_VIRTUAL_KEYBOARD


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	if not CoreSettings.has_int(_ROTATION_CHECK_INTERVAL_KEY):
		LogCore.log_error(_TAG, "init: core settings key SafeAreaCore.rotationCheckIntervalMs is missing or not an integer")
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	node.process_mode = Node.PROCESS_MODE_ALWAYS
	if not EventCore.subscribe(GameAreaChangedEvent, node._on_game_area_changed):
		LogCore.log_error(_TAG, "init: could not subscribe to GameAreaChangedEvent")
		node.free()
		return false
	_rotation_check_interval_ms = CoreSettings.get_int(_ROTATION_CHECK_INTERVAL_KEY)
	_session = RefCounted.new()
	_node = node
	_is_initialized = true
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_update_safe_area()
	_os_keyboard_height = _read_os_keyboard_height()
	_keyboard_area = _compute_keyboard_area()
	_next_rotation_check_ms = Time.get_ticks_msec() + _rotation_check_interval_ms
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	_end_state(node)
	if is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


## The safe area in game coordinates, or an empty rectangle.
static func get_safe_area() -> Rect2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_safe_area: not initialized")
		return Rect2()
	return _safe_area


## The safe area inset of `edge` in game coordinates, or 0.
static func get_inset(edge: Edge) -> float:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_inset: not initialized")
		return 0.0
	match edge:
		Edge.LEFT:
			return _inset_left
		Edge.TOP:
			return _inset_top
		Edge.RIGHT:
			return _inset_right
		Edge.BOTTOM:
			return _inset_bottom
	LogCore.log_error(_TAG, "get_inset: not an edge")
	return 0.0


## The keyboard area in game coordinates. An empty rectangle when no screen keyboard covers the visible game area.
static func get_keyboard_area() -> Rect2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_keyboard_area: not initialized")
		return Rect2()
	return _keyboard_area


static func _end_state(node: _CORE_NODE) -> void:
	if is_instance_valid(node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(node)
	for i: int in _ignores.size():
		if is_instance_valid(_ignores[i]):
			_ignores[i]._stop()
	_is_initialized = false
	_session = null
	_node = null
	_rotation_check_interval_ms = 0
	_next_rotation_check_ms = 0
	_safe_area = Rect2()
	_inset_left = 0.0
	_inset_top = 0.0
	_inset_right = 0.0
	_inset_bottom = 0.0
	_visible_area = Rect2()
	_os_area = Rect2()
	_keyboard_area = Rect2()
	_os_keyboard_height = 0
	_roots = []
	_ignores = []
	_publishing = false
	_safe_area_pending = false
	_keyboard_pending = false
	_has_virtual_notch = false
	_virtual_notch = Vector4i.ZERO
	_virtual_keyboard_height = _NO_VIRTUAL_KEYBOARD


static func _on_node_exit(node: _CORE_NODE) -> void:
	if node != _node or not _is_initialized:
		return
	_end_state(node)


# Frame check of the core node on `android` and `ios`: the OS keyboard height every frame and the OS safe area every
# `SafeAreaCore.rotationCheckIntervalMs` (a 180 degree rotation changes it without a game area change).
static func _on_frame() -> void:
	if not _is_initialized or not _is_mobile():
		return
	var height: int = _read_os_keyboard_height()
	if height != _os_keyboard_height:
		_update_keyboard_area()
		if not _is_initialized:
			return
	var now: int = Time.get_ticks_msec()
	if now < _next_rotation_check_ms:
		return
	_next_rotation_check_ms = now + _rotation_check_interval_ms
	if _read_os_area() != _os_area:
		_recalculate(false)


static func _on_game_area_changed() -> void:
	if not _is_initialized:
		return
	_recalculate(true)


# Recalculates the safe area; when it or an inset changed, places the targets again and publishes
# `SafeAreaChangedEvent`. With `keyboard`, the keyboard area is recalculated after it.
static func _recalculate(keyboard: bool) -> void:
	_safe_area_pending = true
	if keyboard:
		_keyboard_pending = true
	if _publishing:
		return
	var session: RefCounted = _session
	while _safe_area_pending:
		_safe_area_pending = false
		if not _update_safe_area():
			continue
		_place_all()
		var event: SafeAreaChangedEvent = EventCore.acquire(SafeAreaChangedEvent) as SafeAreaChangedEvent
		event.inset_left = _inset_left
		event.inset_top = _inset_top
		event.inset_right = _inset_right
		event.inset_bottom = _inset_bottom
		_publishing = true
		EventCore.publish(event)
		if session != _session:
			return
		_publishing = false
	if _keyboard_pending:
		_keyboard_pending = false
		_update_keyboard_area()


# Calculates the safe area and the insets. Returns whether the safe area or an inset changed.
static func _update_safe_area() -> bool:
	var left: float = 0.0
	var top: float = 0.0
	var right: float = 0.0
	var bottom: float = 0.0
	var safe_area: Rect2 = Rect2()
	var visible_area: Rect2 = Rect2()
	var window: Vector2i = ResolutionCore.get_window_size()
	_os_area = _read_os_area()
	if window.x != 0 and window.y != 0:
		visible_area = ResolutionCore.get_visible_game_area()
		var os_top_left: Vector2 = ResolutionCore.window_to_game(_os_area.position)
		var os_bottom_right: Vector2 = ResolutionCore.window_to_game(_os_area.position + _os_area.size)
		var visible_end: Vector2 = visible_area.position + visible_area.size
		left = maxf(0.0, os_top_left.x - visible_area.position.x)
		top = maxf(0.0, os_top_left.y - visible_area.position.y)
		right = maxf(0.0, visible_end.x - os_bottom_right.x)
		bottom = maxf(0.0, visible_end.y - os_bottom_right.y)
		var base: Vector2i = ResolutionCore.get_base_resolution()
		if base.x > base.y:
			left = maxf(left, right)
			right = left
		safe_area = Rect2(
			visible_area.position.x + left,
			visible_area.position.y + top,
			visible_area.size.x - left - right,
			visible_area.size.y - top - bottom,
		)
		if safe_area.size.x <= 0.0 or safe_area.size.y <= 0.0:
			LogCore.log_error(_TAG, "the safe area width or height is 0 or less; every inset is 0")
			left = 0.0
			top = 0.0
			right = 0.0
			bottom = 0.0
			safe_area = visible_area
	_visible_area = visible_area
	if (
		safe_area == _safe_area
		and left == _inset_left
		and top == _inset_top
		and right == _inset_right
		and bottom == _inset_bottom
	):
		return false
	_safe_area = safe_area
	_inset_left = left
	_inset_top = top
	_inset_right = right
	_inset_bottom = bottom
	return true


# The OS safe area in window pixels: the virtual notch while it is set, on `android` and `ios` the part of the display
# safe area inside the window, and the whole window elsewhere. A display safe area of size 0 (a display server without
# one, such as a headless run) is the whole window. The browser runtime does not read the display safe area (the web
# display server gives the canvas area) and uses the whole window.
static func _read_os_area() -> Rect2:
	var window: Vector2i = ResolutionCore.get_window_size()
	if _has_virtual_notch:
		return Rect2(
			_virtual_notch.x,
			_virtual_notch.y,
			window.x - _virtual_notch.x - _virtual_notch.z,
			window.y - _virtual_notch.y - _virtual_notch.w,
		)
	var whole: Rect2 = Rect2(0, 0, window.x, window.y)
	if not _is_mobile() or OS.get_name() == "Web":
		return whole
	var display_area: Rect2i = DisplayServer.get_display_safe_area()
	if display_area.size == Vector2i.ZERO:
		return whole
	var window_position: Vector2i = DisplayServer.window_get_position()
	var area: Rect2 = Rect2(Vector2(display_area.position - window_position), Vector2(display_area.size))
	return area.intersection(whole)


# The OS keyboard height in window pixels: the virtual keyboard while it is set, on `android` and `ios` the OS value when
# the display server has a virtual keyboard, and 0 otherwise.
static func _read_os_keyboard_height() -> int:
	if _virtual_keyboard_height != _NO_VIRTUAL_KEYBOARD:
		return _virtual_keyboard_height
	if _is_mobile() and DisplayServer.has_feature(DisplayServer.FEATURE_VIRTUAL_KEYBOARD):
		return DisplayServer.virtual_keyboard_get_height()
	return 0


# Calculates the keyboard area; publishes `KeyboardAreaChangedEvent` when it changed.
static func _update_keyboard_area() -> void:
	_os_keyboard_height = _read_os_keyboard_height()
	var area: Rect2 = _compute_keyboard_area()
	if area == _keyboard_area:
		return
	_keyboard_area = area
	var event: KeyboardAreaChangedEvent = EventCore.acquire(KeyboardAreaChangedEvent) as KeyboardAreaChangedEvent
	event.area = area
	EventCore.publish(event)


static func _compute_keyboard_area() -> Rect2:
	var height: int = _os_keyboard_height
	var window: Vector2i = ResolutionCore.get_window_size()
	if height <= 0 or window.x == 0 or window.y == 0:
		return Rect2()
	var top_left: Vector2 = ResolutionCore.window_to_game(Vector2(0, window.y - height))
	var bottom_right: Vector2 = ResolutionCore.window_to_game(Vector2(window.x, window.y))
	var visible_area: Rect2 = ResolutionCore.get_visible_game_area()
	var visible_end: Vector2 = visible_area.position + visible_area.size
	var left: float = maxf(top_left.x, visible_area.position.x)
	var top: float = maxf(top_left.y, visible_area.position.y)
	var right: float = minf(bottom_right.x, visible_end.x)
	var bottom: float = minf(bottom_right.y, visible_end.y)
	if right - left <= 0.0 or bottom - top <= 0.0:
		return Rect2()
	return Rect2(left, top, right - left, bottom - top)


static func _is_mobile() -> bool:
	return CoreBuildInfo.platform == "android" or CoreBuildInfo.platform == "ios"


static func _place_all() -> void:
	for i: int in _roots.size():
		if is_instance_valid(_roots[i]):
			_place_root(_roots[i])
	for i: int in _ignores.size():
		if is_instance_valid(_ignores[i]):
			_place_ignore(_ignores[i])


static func _register_root(root: SafeAreaRoot) -> void:
	if not _is_initialized or _roots.has(root):
		return
	_roots.append(root)
	_place_root(root)


static func _unregister_root(root: SafeAreaRoot) -> void:
	if not _is_initialized:
		return
	_roots.erase(root)


static func _place_root(root: SafeAreaRoot) -> void:
	root.set_anchors_preset(Control.PRESET_TOP_LEFT, true)
	root.global_position = _safe_area.position
	root.size = _safe_area.size


static func _register_ignore(ignore: SafeAreaIgnore) -> void:
	if not _is_initialized or _ignores.has(ignore):
		return
	_ignores.append(ignore)
	ignore._start(_session)
	_place_ignore(ignore)


static func _unregister_ignore(ignore: SafeAreaIgnore) -> void:
	if not _is_initialized:
		return
	ignore._stop()
	_ignores.erase(ignore)


# Places the UI element of the ignore mark: its anchors and its offsets from the time it was registered are taken
# against the visible game area instead of its parent.
static func _place_ignore(ignore: SafeAreaIgnore) -> void:
	var control: Control = ignore.get_parent() as Control
	if control == null:
		return
	var offsets: Vector4 = ignore._design_offsets_of(control)
	var area: Rect2 = _visible_area
	var top_left: Vector2 = Vector2(
		area.position.x + control.anchor_left * area.size.x + offsets.x,
		area.position.y + control.anchor_top * area.size.y + offsets.y,
	)
	var bottom_right: Vector2 = Vector2(
		area.position.x + control.anchor_right * area.size.x + offsets.z,
		area.position.y + control.anchor_bottom * area.size.y + offsets.w,
	)
	var parent: CanvasItem = control.get_parent() as CanvasItem
	if parent != null:
		var to_parent: Transform2D = parent.get_global_transform().affine_inverse()
		top_left = to_parent * top_left
		bottom_right = to_parent * bottom_right
	var parent_size: Vector2 = control.get_parent_area_size()
	control.offset_left = top_left.x - control.anchor_left * parent_size.x
	control.offset_top = top_left.y - control.anchor_top * parent_size.y
	control.offset_right = bottom_right.x - control.anchor_right * parent_size.x
	control.offset_bottom = bottom_right.y - control.anchor_bottom * parent_size.y


# Deferred after the registration, so that the code that added the element can finish sizing its parent first.
static func _check_ignore(ignore: SafeAreaIgnore, session: RefCounted) -> void:
	if not _is_initialized or session != _session or not _ignores.has(ignore):
		return
	_place_ignore(ignore)
	if not CoreBuildInfo.has_dev_code or ignore._parent_error_logged:
		return
	var control: Control = ignore.get_parent() as Control
	if control == null:
		return
	var parent: Node = control.get_parent()
	if parent is SafeAreaRoot:
		return
	if parent is Control and (parent as Control).get_global_rect().is_equal_approx(_safe_area):
		return
	ignore._parent_error_logged = true
	LogCore.log_error(_TAG, "the parent of a UI element with an ignore mark is neither a safe area root nor of its position and size: " + str(control.get_path()))
