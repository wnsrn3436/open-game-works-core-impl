class_name ResolutionCore
extends RefCounted
## Computes the game area and the scale from the base resolution and the max resolution, applies them to the
## window, and owns the fill area outside the game area and the screen mode.

enum ScreenOrientation { LANDSCAPE, PORTRAIT }
enum FillMode { CROP, LETTERBOX }
enum ScreenMode { WINDOWED, FULLSCREEN }

const _TAG: String = "ResolutionCore"
const _CORE_NODE := preload("res://core/resolution_core/resolution_core_node.gd")

const _SETTING_BASE: String = "baseResolution"
const _SETTING_MAX: String = "maxResolution"
const _SETTING_FILL_COLOR: String = "ResolutionCore.fillColor"
const _SETTING_FILL_IMAGE: String = "ResolutionCore.fillImage"
## `LocalDataCore` key of the saved screen mode: 0 is `Windowed`, 1 is `Fullscreen`.
const _KEY_SCREEN_MODE: String = "ResolutionCore.screen_mode"
const _SAVED_WINDOWED: int = 0
const _SAVED_FULLSCREEN: int = 1

const _SCREEN_MODE_PLATFORMS: PackedStringArray = ["windows", "macos", "linux"]
const _CROP_PLATFORM: String = "ios"
## The only platform whose window changes screen mode by a transition (`[NSWindow toggleFullScreen:]`, about 0.5 s).
const _TRANSITION_PLATFORM: String = "macos"

# Screen mode transition states.
const _NO_TRANSITION: int = 0
const _ENTER: int = 1
const _LEAVE: int = 2
## The transition of a platform without transitions: it ends with the frame of the request.
const _FRAME: int = 3

## Margin of the window area floor against the rounding of the divisions before it.
const _FLOOR_MARGIN: float = 0.000001

static var _is_initialized: bool = false
## New at every `init`; an async operation that comes back to another session stops.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null
## True while the module sets the window, so the `size_changed` the window sends back starts no recalculation.
static var _applying: bool = false

# Settings read in `init`.
static var _base: Vector2i = Vector2i.ZERO
static var _max: Vector2i = Vector2i.ZERO
static var _fill_color: Color = Color.BLACK
static var _fill_image_key: String = ""
static var _platform_fill_mode: FillMode = FillMode.LETTERBOX
static var _platform_supported: bool = false

# `ResolutionCoreDev.set_test_screen` values. Only the DEV code and the core tests write them.
static var _test_active: bool = false
static var _test_base: Vector2i = Vector2i.ZERO
static var _test_window: Vector2i = Vector2i.ZERO
static var _test_fill_mode: FillMode = FillMode.LETTERBOX
static var _test_supported: bool = false

# Result of the last recalculation.
static var _orientation: ScreenOrientation = ScreenOrientation.LANDSCAPE
static var _window_size: Vector2i = Vector2i.ZERO
static var _fill_mode: FillMode = FillMode.LETTERBOX
static var _game_area: Rect2 = Rect2()
static var _visible_game_area: Rect2 = Rect2()
static var _scale: float = 0.0
## Window area size: window size ÷ scale, floored on each axis.
static var _window_area: Vector2i = Vector2i.ZERO

# Screen mode transition of the window, started by a request of this module in this `init`.
static var _transition: int = _NO_TRANSITION
## An enter saw the root window title bar change of its end (`windowDidEnterFullScreen`).
static var _transition_titlebar: bool = false
## A leave saw the window unable to draw.
static var _transition_hidden: bool = false
## Process frame of the request of a `_FRAME` transition.
static var _transition_frame: int = 0

# Fill image.
static var _fill_load_started: bool = false
static var _fill_loading: bool = false
static var _fill_texture: Texture2D = null


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init found no SceneTree")
		return false
	if not _read_settings():
		return false
	if _max.x < _base.x or _max.y < _base.y:
		LogCore.log_error(_TAG, "max resolution is smaller than the base resolution on an axis; that axis uses the base resolution")
	var platform: String = CoreBuildInfo.platform
	_platform_fill_mode = FillMode.CROP if platform == _CROP_PLATFORM else FillMode.LETTERBOX
	_platform_supported = _SCREEN_MODE_PLATFORMS.has(platform)
	_session = RefCounted.new()
	_node = _CORE_NODE.new()
	_node.name = _TAG
	_node.setup()
	tree.root.add_child(_node)
	if tree.root.size_changed.connect(_node._on_size_changed) != OK:
		LogCore.log_error(_TAG, "init could not connect the window size_changed signal")
		_clean_up(true)
		return false
	if tree.root.titlebar_changed.connect(_node._on_titlebar_changed) != OK:
		LogCore.log_error(_TAG, "init could not connect the window titlebar_changed signal")
		_clean_up(true)
		return false
	_is_initialized = true
	_recalculate(true)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


static func get_orientation() -> ScreenOrientation:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_orientation called before init")
		return ScreenOrientation.LANDSCAPE
	return _orientation


static func get_base_resolution() -> Vector2i:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_base_resolution called before init")
		return Vector2i.ZERO
	return _test_base if _test_active else _base


static func get_window_size() -> Vector2i:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_window_size called before init")
		return Vector2i.ZERO
	return _window_size


static func get_game_area() -> Rect2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_game_area called before init")
		return Rect2()
	return _game_area


static func get_visible_game_area() -> Rect2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_visible_game_area called before init")
		return Rect2()
	return _visible_game_area


static func get_scale() -> float:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_scale called before init")
		return 0.0
	return _scale


static func get_fill_mode() -> FillMode:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_fill_mode called before init")
		return FillMode.LETTERBOX
	return _fill_mode


## Window pixel position to game coordinates: on each axis, position × window area size ÷ window size.
static func window_to_game(window_position: Vector2) -> Vector2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "window_to_game called before init")
		return Vector2.ZERO
	if _window_size.x <= 0 or _window_size.y <= 0:
		return Vector2.ZERO
	return Vector2(
		window_position.x * _window_area.x / _window_size.x,
		window_position.y * _window_area.y / _window_size.y
	)


## Game coordinates to window pixel position: the inverse of `window_to_game`.
static func game_to_window(game_position: Vector2) -> Vector2:
	if not _is_initialized:
		LogCore.log_error(_TAG, "game_to_window called before init")
		return Vector2.ZERO
	if _window_area.x <= 0 or _window_area.y <= 0:
		return Vector2.ZERO
	return Vector2(
		game_position.x * _window_size.x / _window_area.x,
		game_position.y * _window_size.y / _window_area.y
	)


static func is_screen_mode_supported() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_screen_mode_supported called before init")
		return false
	return _is_supported()


## The window's current screen mode, not the saved one.
static func get_screen_mode() -> ScreenMode:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_screen_mode called before init")
		return ScreenMode.FULLSCREEN
	if not _is_supported():
		LogCore.log_error(_TAG, "get_screen_mode called on a platform without screen modes")
		return ScreenMode.FULLSCREEN
	return _window_screen_mode()


## Applies the screen mode to the window, then saves it. Refused, false without a log, before the end of a screen mode
## transition this module requested in this `init`.
static func set_screen_mode(mode: ScreenMode) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_screen_mode called before init")
		return false
	if mode != ScreenMode.WINDOWED and mode != ScreenMode.FULLSCREEN:
		LogCore.log_error(_TAG, "set_screen_mode got a value that is not a screen mode")
		return false
	if not _is_supported():
		LogCore.log_error(_TAG, "set_screen_mode called on a platform without screen modes")
		return false
	if _is_in_transition():
		return false
	_apply_screen_mode(mode)
	var saved: int = _SAVED_FULLSCREEN if mode == ScreenMode.FULLSCREEN else _SAVED_WINDOWED
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_SCREEN_MODE, saved)
	return true


## Applies the saved screen mode. `BootstrapCore` calls it after `LocalDataCore.load_device_file`.
static func apply_saved_screen_mode() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "apply_saved_screen_mode called before init")
		return
	if not _is_supported():
		return
	var saved: int = LocalDataCore.get_value_int(LocalDataCore.FileKind.DEVICE, _KEY_SCREEN_MODE, _SAVED_WINDOWED)
	var mode: ScreenMode = ScreenMode.WINDOWED
	if saved == _SAVED_FULLSCREEN:
		mode = ScreenMode.FULLSCREEN
	elif saved != _SAVED_WINDOWED:
		LogCore.log_warn(_TAG, "saved screen mode is neither 0 nor 1; using Windowed")
	_apply_screen_mode(mode)


## Starts loading the fill image in the `ResourceCore` global scope and does not wait. Once per `init`.
static func load_fill_image() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "load_fill_image called before init")
		return
	if _fill_load_started:
		LogCore.log_error(_TAG, "load_fill_image called again after init")
		return
	_fill_load_started = true
	if _fill_image_key.is_empty():
		return
	_load_fill_image(_session)


static func _load_fill_image(session: RefCounted) -> void:
	_fill_loading = true
	var kind: int = ResourceCore.BaseKind.TEXTURE_2D
	var resource: Resource = await ResourceCore.load(_fill_image_key, kind, ResourceCore.get_global_scope())
	if session != _session:
		return
	_fill_loading = false
	var texture: Texture2D = resource as Texture2D
	if texture == null:
		return
	_fill_texture = texture
	_layout_fill()


# Settings


## Reads the settings of `## settings`. Logs an error and returns false when one is missing or invalid.
static func _read_settings() -> bool:
	var base: PackedInt64Array = _read_size(_SETTING_BASE)
	var max_resolution: PackedInt64Array = _read_size(_SETTING_MAX)
	if base.is_empty() or max_resolution.is_empty():
		return false
	if not _is_valid_base(Vector2i(base[0], base[1])):
		LogCore.log_error(_TAG, "base resolution has equal sides or a side below 1")
		return false
	if not CoreSettings.has_int_array(_SETTING_FILL_COLOR):
		LogCore.log_error(_TAG, "core settings has no integer array ResolutionCore.fillColor")
		return false
	var color: PackedInt64Array = CoreSettings.get_int_array(_SETTING_FILL_COLOR)
	if color.size() != 3:
		LogCore.log_error(_TAG, "ResolutionCore.fillColor does not have 3 elements")
		return false
	if not CoreSettings.has_string(_SETTING_FILL_IMAGE):
		LogCore.log_error(_TAG, "core settings has no string ResolutionCore.fillImage")
		return false
	var clamped: bool = false
	for value: int in color:
		if value < 0 or value > 255:
			clamped = true
	if clamped:
		LogCore.log_error(_TAG, "ResolutionCore.fillColor has an element outside 0 to 255; using the nearest end")
	_base = Vector2i(base[0], base[1])
	_max = Vector2i(max_resolution[0], max_resolution[1])
	_fill_color = Color8(clampi(color[0], 0, 255), clampi(color[1], 0, 255), clampi(color[2], 0, 255))
	_fill_image_key = CoreSettings.get_string(_SETTING_FILL_IMAGE)
	return true


## The width and height of an integer array setting of 2 elements. Empty after an error log when the setting is
## missing or does not have 2 elements.
static func _read_size(key: String) -> PackedInt64Array:
	var none: PackedInt64Array = PackedInt64Array()
	if not CoreSettings.has_int_array(key):
		LogCore.log_error(_TAG, "settings has no integer array " + key)
		return none
	var values: PackedInt64Array = CoreSettings.get_int_array(key)
	if values.size() != 2:
		LogCore.log_error(_TAG, "settings " + key + " does not have 2 elements")
		return none
	return values


static func _is_valid_base(base: Vector2i) -> bool:
	return base.x >= 1 and base.y >= 1 and base.x != base.y


# Recalculation


static func _on_window_size_changed() -> void:
	if not _is_initialized or _applying or _test_active:
		return
	_recalculate(false)


## Recalculates from the window size and applies a changed result. `at_init` keeps an all-zero result for a zero
## window size and publishes no event.
static func _recalculate(at_init: bool) -> void:
	var base: Vector2i = _test_base if _test_active else _base
	var window: Vector2i = _test_window if _test_active else _root_size()
	var fill_mode: FillMode = _test_fill_mode if _test_active else _platform_fill_mode
	_orientation = ScreenOrientation.LANDSCAPE if base.x > base.y else ScreenOrientation.PORTRAIT
	if window.x <= 0 or window.y <= 0:
		if at_init:
			_window_size = Vector2i.ZERO
			_fill_mode = fill_mode
			_game_area = Rect2()
			_visible_game_area = Rect2()
			_scale = 0.0
			_window_area = Vector2i.ZERO
			_layout_fill()
		return
	var max_x: float = maxi(_max.x, base.x)
	var max_y: float = maxi(_max.y, base.y)
	var wx: float = window.x
	var wy: float = window.y
	var bx: float = base.x
	var by: float = base.y
	# Widened size: window size ÷ fit scale. The axis that sets the fit scale keeps the base resolution exactly.
	var widened_x: float = bx
	var widened_y: float = by
	if wx * by <= wy * bx:
		widened_y = wy * bx / wx
	else:
		widened_x = wx * by / wy
	var game_x: float = minf(widened_x, max_x)
	var game_y: float = minf(widened_y, max_y)
	# Scale: Crop takes the larger of the two axis ratios, Letterbox the smaller. The axis that sets the scale
	# has a window area of the game area size exactly.
	var x_ratio_larger: bool = wx * game_y >= wy * game_x
	var use_x: bool = x_ratio_larger if fill_mode == FillMode.CROP else not x_ratio_larger
	var scale: float = 0.0
	var area_x: float = 0.0
	var area_y: float = 0.0
	if use_x:
		scale = wx / game_x
		area_x = game_x
		area_y = wy * game_x / wx
	else:
		scale = wy / game_y
		area_x = wx * game_y / wy
		area_y = game_y
	var window_area: Vector2i = Vector2i(floori(area_x + _FLOOR_MARGIN), floori(area_y + _FLOOR_MARGIN))
	var game_area: Rect2 = Rect2((window_area.x - game_x) / 2.0, (window_area.y - game_y) / 2.0, game_x, game_y)
	var visible: Rect2 = _overlap(game_area, Rect2(Vector2.ZERO, Vector2(window_area)))
	var area_changed: bool = (
		window != _window_size
		or game_area != _game_area
		or visible != _visible_game_area
		or scale != _scale
	)
	var changed: bool = area_changed or fill_mode != _fill_mode or window_area != _window_area
	_window_size = window
	_fill_mode = fill_mode
	_game_area = game_area
	_visible_game_area = visible
	_scale = scale
	_window_area = window_area
	if not changed and not at_init:
		return
	_apply_window()
	_layout_fill()
	if area_changed and not at_init:
		_publish_changed()


## The rectangle two rectangles overlap in. The empty rectangle when its width or height is 0 or less.
static func _overlap(a: Rect2, b: Rect2) -> Rect2:
	var left: float = maxf(a.position.x, b.position.x)
	var top: float = maxf(a.position.y, b.position.y)
	var right: float = minf(a.position.x + a.size.x, b.position.x + b.size.x)
	var bottom: float = minf(a.position.y + a.size.y, b.position.y + b.size.y)
	if right - left <= 0.0 or bottom - top <= 0.0:
		return Rect2()
	return Rect2(left, top, right - left, bottom - top)


## Shows the window area on the whole window: the window area size is the root viewport size, stretched to the
## window on each axis.
static func _apply_window() -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or _window_area.x <= 0 or _window_area.y <= 0:
		return
	var root: Window = tree.root
	_applying = true
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	root.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_IGNORE
	root.content_scale_stretch = Window.CONTENT_SCALE_STRETCH_FRACTIONAL
	root.content_scale_factor = 1.0
	root.content_scale_size = _window_area
	_applying = false


## Draws the widened size on the window, as before `init`: the base resolution expanded to the window aspect.
static func _apply_widened(base: Vector2i) -> void:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null or not _is_valid_base(base):
		return
	var root: Window = tree.root
	_applying = true
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_CANVAS_ITEMS
	root.content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	root.content_scale_stretch = Window.CONTENT_SCALE_STRETCH_FRACTIONAL
	root.content_scale_factor = 1.0
	root.content_scale_size = base
	_applying = false


static func _layout_fill() -> void:
	if _node == null:
		return
	var has_fill: bool = (
		_fill_mode == FillMode.LETTERBOX
		and (_game_area.position.x > _FLOOR_MARGIN or _game_area.position.y > _FLOOR_MARGIN)
	)
	_node.layout_fill(_window_area, _game_area, has_fill, _fill_color, _fill_texture)


static func _publish_changed() -> void:
	if not EventCore.is_initialized():
		return
	var event := EventCore.acquire(GameAreaChangedEvent) as GameAreaChangedEvent
	if event != null:
		EventCore.publish(event)


static func _root_size() -> Vector2i:
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		return Vector2i.ZERO
	return tree.root.size


# Screen mode


static func _is_supported() -> bool:
	return _test_supported if _test_active else _platform_supported


static func _window_screen_mode() -> ScreenMode:
	var mode: DisplayServer.WindowMode = DisplayServer.window_get_mode()
	if mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN:
		return ScreenMode.FULLSCREEN
	return ScreenMode.WINDOWED


## Puts the window in the screen mode. A window already in that screen mode keeps its window mode, so a
## maximized window stays maximized.
static func _apply_screen_mode(mode: ScreenMode) -> void:
	if _window_screen_mode() == mode:
		return
	if mode == ScreenMode.FULLSCREEN:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	_start_transition(mode)


## Starts the transition of a request for `mode`. Off the platform with transitions, the transition ends with the frame
## of the request, whatever the engine reads right after it: a driver can change the mode later (Wayland at the
## compositor's configure). On the platform with transitions, `window_set_mode` sets the mode the engine reads before it
## returns, so a window that reads another mode did not take the request (no window, a headless display server): AppKit
## starts no transition, and an enter or leave there would never see its end.
static func _start_transition(mode: ScreenMode) -> void:
	if CoreBuildInfo.platform != _TRANSITION_PLATFORM:
		_transition = _FRAME
		_transition_frame = Engine.get_process_frames()
		return
	if _node == null or _window_screen_mode() != mode:
		return
	_transition = _ENTER if mode == ScreenMode.FULLSCREEN else _LEAVE
	_transition_titlebar = false
	_transition_hidden = false
	_node.set_process(true)


static func _on_window_titlebar_changed() -> void:
	if _transition == _ENTER:
		_transition_titlebar = true


## Whether a screen mode transition this module requested in this `init` has not ended.
static func _is_in_transition() -> bool:
	if _transition == _FRAME and Engine.get_process_frames() != _transition_frame:
		_end_transition()
	return _transition != _NO_TRANSITION


## Once a frame during a transition on the platform with transitions. An enter ends at the title bar change of its end
## and a window that can draw, a leave when the window cannot draw and then can again.
static func _on_transition_frame() -> void:
	if not _is_initialized or _transition == _NO_TRANSITION or _transition == _FRAME:
		return
	var can_draw: bool = DisplayServer.window_can_draw()
	if _transition == _ENTER:
		if not _transition_titlebar or not can_draw:
			return
	elif not can_draw:
		_transition_hidden = true
		return
	elif not _transition_hidden:
		return
	_end_transition()


static func _end_transition() -> void:
	_transition = _NO_TRANSITION
	_transition_titlebar = false
	_transition_hidden = false
	_transition_frame = 0
	if _node != null and is_instance_valid(_node):
		_node.set_process(false)


# DEV


## `ResolutionCoreDev.set_test_screen`.
static func _set_test_screen(base: Vector2i, window: Vector2i, fill_mode: FillMode, supported: bool) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_test_screen called before init")
		return
	if not _is_valid_base(base):
		LogCore.log_error(_TAG, "set_test_screen got a base resolution with equal sides or a side below 1")
		return
	if window.x < 0 or window.y < 0:
		LogCore.log_error(_TAG, "set_test_screen got a negative window size")
		return
	if fill_mode != FillMode.CROP and fill_mode != FillMode.LETTERBOX:
		LogCore.log_error(_TAG, "set_test_screen got a value that is not a fill mode")
		return
	if window.x == 0 or window.y == 0:
		return
	if _max.x < base.x or _max.y < base.y:
		LogCore.log_error(_TAG, "max resolution is smaller than the test base resolution on an axis; that axis uses the base resolution")
	_test_active = true
	_test_base = base
	_test_window = window
	_test_fill_mode = fill_mode
	_test_supported = supported
	_recalculate(false)


# Lifecycle


static func _on_core_node_exit(node: Node) -> void:
	if node == _node and _is_initialized:
		_clean_up(false)


## `release`: puts every state back to its value before `init`. `detach` takes the core node out of the tree.
static func _clean_up(detach: bool) -> void:
	var node: _CORE_NODE = _node
	var base: Vector2i = _base
	_node = null
	_is_initialized = false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if node != null and is_instance_valid(node):
		if tree != null and tree.root.size_changed.is_connected(node._on_size_changed):
			tree.root.size_changed.disconnect(node._on_size_changed)
		if tree != null and tree.root.titlebar_changed.is_connected(node._on_titlebar_changed):
			tree.root.titlebar_changed.disconnect(node._on_titlebar_changed)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()
	_apply_widened(base)
	_session = null
	_applying = false
	_base = Vector2i.ZERO
	_max = Vector2i.ZERO
	_fill_color = Color.BLACK
	_fill_image_key = ""
	_platform_fill_mode = FillMode.LETTERBOX
	_platform_supported = false
	_test_active = false
	_test_base = Vector2i.ZERO
	_test_window = Vector2i.ZERO
	_test_fill_mode = FillMode.LETTERBOX
	_test_supported = false
	_orientation = ScreenOrientation.LANDSCAPE
	_window_size = Vector2i.ZERO
	_fill_mode = FillMode.LETTERBOX
	_game_area = Rect2()
	_visible_game_area = Rect2()
	_scale = 0.0
	_window_area = Vector2i.ZERO
	_transition = _NO_TRANSITION
	_transition_titlebar = false
	_transition_hidden = false
	_transition_frame = 0
	_fill_load_started = false
	_fill_loading = false
	_fill_texture = null
