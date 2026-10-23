class_name AccessibilityCore
extends RefCounted
## User options for text scale, color mode, voice subtitles, reduce shake and reduce flash. Keeps them in the
## `device` file and applies them to `LocalizationCore`, the color filter, `play_voice`, `CameraCore` and
## `ScreenEffectCore`.

enum ColorMode { NONE, PROTANOPIA, DEUTERANOPIA, TRITANOPIA }

const _TAG: String = "AccessibilityCore"
const _CORE_NODE := preload("res://core/accessibility_core/accessibility_core_node.gd")

const _SETTING_TEXT_SCALES: String = "AccessibilityCore.textScales"
const _SETTING_SUBTITLES_DEFAULT: String = "AccessibilityCore.subtitlesDefault"
const _SETTING_COLOR_FILTER_ENABLED: String = "AccessibilityCore.colorFilterEnabled"
const _SETTING_COLOR_MATRICES: String = "AccessibilityCore.colorMatrices"
const _SETTING_REDUCED_SHAKE: String = "AccessibilityCore.reducedShakePermille"
const _SETTING_REDUCED_FLASH: String = "AccessibilityCore.reducedFlashMaxOpacity"
const _SETTING_SUBTITLE_WIDTH: String = "AccessibilityCore.subtitleWidthPermille"
const _SETTING_SUBTITLE_OPACITY: String = "AccessibilityCore.subtitleBoxOpacity"
const _SETTING_SUBTITLE_FONT_SIZE: String = "AccessibilityCore.subtitleFontSize"
const _SETTING_SUBTITLE_PADDING: String = "AccessibilityCore.subtitlePadding"
const _SETTING_SUBTITLE_MARGIN: String = "AccessibilityCore.subtitleBottomMargin"

## `LocalDataCore` keys of the `device` file.
const _KEY_TEXT_SCALE: String = "AccessibilityCore.text_scale"
const _KEY_COLOR_MODE: String = "AccessibilityCore.color_mode"
const _KEY_SUBTITLES: String = "AccessibilityCore.subtitles"
const _KEY_REDUCE_SHAKE: String = "AccessibilityCore.reduce_shake"
const _KEY_REDUCE_FLASH: String = "AccessibilityCore.reduce_flash"

## Element names of `ColorMode`, indexed by the member.
const _COLOR_MODE_NAMES: PackedStringArray = ["None", "Protanopia", "Deuteranopia", "Tritanopia"]
const _DEFAULT_TEXT_SCALE: int = 1000
const _FULL_SHAKE_PERMILLE: int = 1000
const _FULL_FLASH_OPACITY: float = 1.0
const _MATRIX_SIZE: int = 9
## Rendering methods whose `canvas_item` shaders read the screen texture.
const _SCREEN_SHADER_METHODS: PackedStringArray = ["forward_plus", "mobile", "gl_compatibility"]
## The color filter: each screen pixel times the color matrix of the color mode, row by row.
const _FILTER_SHADER: String = """shader_type canvas_item;

uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;
uniform vec3 row_r = vec3(1.0, 0.0, 0.0);
uniform vec3 row_g = vec3(0.0, 1.0, 0.0);
uniform vec3 row_b = vec3(0.0, 0.0, 1.0);

void fragment() {
	vec3 source = textureLod(screen_texture, SCREEN_UV, 0.0).rgb;
	COLOR = vec4(clamp(vec3(dot(row_r, source), dot(row_g, source), dot(row_b, source)), 0.0, 1.0), 1.0);
}
"""
const _ROW_R: StringName = &"row_r"
const _ROW_G: StringName = &"row_g"
const _ROW_B: StringName = &"row_b"
const _FONT_SIZE: StringName = &"font_size"
const _FONT_COLOR: StringName = &"font_color"

static var _is_initialized: bool = false
static var _node: _CORE_NODE = null
static var _text_scales: PackedInt64Array = PackedInt64Array()
static var _subtitles_default: bool = false
static var _filter_enabled: bool = false
## Color matrix (9 numbers, row-major) of each `ColorMode`, indexed by the member. `NONE` has an empty array.
static var _matrices: Array[PackedFloat64Array] = []
static var _reduced_shake_permille: int = 0
static var _reduced_flash_max_opacity: float = 0.0
static var _subtitle_width_permille: int = 0
static var _subtitle_box_opacity: float = 0.0
static var _subtitle_font_size: int = 0
static var _subtitle_padding: float = 0.0
static var _subtitle_bottom_margin: float = 0.0
## The option values that are applied now.
static var _settings: AccessibilitySettings = null
## Code-made color filter on the `LoadingIcon` layer. `null` when `colorFilterEnabled` is false or the engine cannot
## run a full screen shader.
static var _filter: ColorRect = null
static var _filter_material: ShaderMaterial = null
## Code-made subtitle box on the `Message` layer and its text.
static var _subtitle_box: ColorRect = null
static var _subtitle_label: Label = null
## Play handle of the voice whose subtitle is on screen. `SoundCore.INVALID_HANDLE` when no subtitle is on screen.
static var _subtitle_handle: int = SoundCore.INVALID_HANDLE


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	if not _read_settings():
		_reset_state()
		return false
	var message_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.MESSAGE)
	var icon_layer: CanvasLayer = UICore.get_layer(UICore.UILayer.LOADING_ICON)
	if message_layer == null or icon_layer == null:
		LogCore.log_error(_TAG, "init: UICore gave no Message or LoadingIcon layer")
		_reset_state()
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	if not EventCore.subscribe(SafeAreaChangedEvent, node._on_safe_area_changed):
		LogCore.log_error(_TAG, "init could not subscribe to SafeAreaChangedEvent")
		node.free()
		_reset_state()
		return false
	_node = node
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_make_subtitle_box(message_layer)
	if _filter_enabled:
		if _SCREEN_SHADER_METHODS.has(RenderingServer.get_current_rendering_method()):
			_make_filter(icon_layer)
		else:
			LogCore.log_warn(_TAG, "the engine cannot run a full screen shader; the color filter is not applied")
	_settings = _default_settings()
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	if is_instance_valid(node):
		node.released = true
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


## Reads the saved option values and applies them all. A missing value, a value of another type and a value out of
## its allowed values are the default, without a log.
static func apply_saved_settings() -> void:
	if not _check_initialized("apply_saved_settings"):
		return
	var kind: LocalDataCore.FileKind = LocalDataCore.FileKind.DEVICE
	var saved: AccessibilitySettings = _default_settings()
	var text_scale: int = LocalDataCore.get_value_int(kind, _KEY_TEXT_SCALE, _DEFAULT_TEXT_SCALE)
	if _text_scales.has(text_scale):
		saved.text_scale_permille = text_scale
	var mode_name: String = LocalDataCore.get_value_string(kind, _KEY_COLOR_MODE, _COLOR_MODE_NAMES[ColorMode.NONE])
	var mode: int = _COLOR_MODE_NAMES.find(mode_name)
	if mode >= 0:
		saved.color_mode = mode as ColorMode
	saved.subtitles = LocalDataCore.get_value_bool(kind, _KEY_SUBTITLES, saved.subtitles)
	saved.reduce_shake = LocalDataCore.get_value_bool(kind, _KEY_REDUCE_SHAKE, false)
	saved.reduce_flash = LocalDataCore.get_value_bool(kind, _KEY_REDUCE_FLASH, false)
	_settings = saved
	_apply_text_scale()
	_apply_color_mode()
	_apply_subtitles()
	_apply_reduce_shake()
	_apply_reduce_flash()


## A copy of the option values. The default values before `init`.
static func get_settings() -> AccessibilitySettings:
	if not _check_initialized("get_settings"):
		var fallback: AccessibilitySettings = AccessibilitySettings.new()
		fallback.subtitles = CoreSettings.get_bool(_SETTING_SUBTITLES_DEFAULT)
		return fallback
	return _copy(_settings)


## Sets the text scale to `permille`, one of `AccessibilityCore.textScales`.
static func set_text_scale(permille: int) -> bool:
	if not _check_initialized("set_text_scale"):
		return false
	if not _text_scales.has(permille):
		LogCore.log_error(_TAG, "set_text_scale got %d, which is not in AccessibilityCore.textScales" % permille)
		return false
	if permille == _settings.text_scale_permille:
		return true
	_settings.text_scale_permille = permille
	_apply_text_scale()
	LocalDataCore.set_value_int(LocalDataCore.FileKind.DEVICE, _KEY_TEXT_SCALE, permille)
	_publish_changed()
	return true


static func set_color_mode(mode: ColorMode) -> bool:
	if not _check_initialized("set_color_mode"):
		return false
	if mode < 0 or mode >= _COLOR_MODE_NAMES.size():
		LogCore.log_error(_TAG, "set_color_mode got %d, which is not a ColorMode" % mode)
		return false
	if mode == _settings.color_mode:
		return true
	_settings.color_mode = mode
	_apply_color_mode()
	LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_COLOR_MODE, _COLOR_MODE_NAMES[mode])
	_publish_changed()
	return true


static func set_subtitles(enabled: bool) -> void:
	if not _check_initialized("set_subtitles"):
		return
	if enabled == _settings.subtitles:
		return
	_settings.subtitles = enabled
	_apply_subtitles()
	LocalDataCore.set_value_bool(LocalDataCore.FileKind.DEVICE, _KEY_SUBTITLES, enabled)
	_publish_changed()


static func set_reduce_shake(enabled: bool) -> void:
	if not _check_initialized("set_reduce_shake"):
		return
	if enabled == _settings.reduce_shake:
		return
	_settings.reduce_shake = enabled
	_apply_reduce_shake()
	LocalDataCore.set_value_bool(LocalDataCore.FileKind.DEVICE, _KEY_REDUCE_SHAKE, enabled)
	_publish_changed()


static func set_reduce_flash(enabled: bool) -> void:
	if not _check_initialized("set_reduce_flash"):
		return
	if enabled == _settings.reduce_flash:
		return
	_settings.reduce_flash = enabled
	_apply_reduce_flash()
	LocalDataCore.set_value_bool(LocalDataCore.FileKind.DEVICE, _KEY_REDUCE_FLASH, enabled)
	_publish_changed()


## Plays the voice `key` on the `Voice` bus in `scope` and, while subtitles are on, shows the text of `subtitle_key`
## (formatted with `args` when given) until the play ends. Returns the `SoundCore` play handle.
static func play_voice(key: String, scope: Scope, subtitle_key: String, args: FormatArgs = null) -> int:
	if not _check_initialized("play_voice"):
		return SoundCore.INVALID_HANDLE
	var handle: int = SoundCore.play(key, SoundCore.SoundBus.VOICE, scope)
	if subtitle_key.is_empty():
		LogCore.log_error(_TAG, "play_voice got an empty subtitle translation key")
		return handle
	if handle == SoundCore.INVALID_HANDLE or not _settings.subtitles:
		return handle
	if args == null:
		_subtitle_label.text = LocalizationCore.get_text(subtitle_key)
	else:
		_subtitle_label.text = LocalizationCore.format(subtitle_key, args)
	_subtitle_handle = handle
	_subtitle_box.visible = true
	_layout_subtitle()
	return handle


static func _check_initialized(operation: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, operation + " called before init")
	return _is_initialized


## Reads and checks the settings of `## settings`. Logs and fails when a key is missing, has another type or is out of
## its range.
static func _read_settings() -> bool:
	if not CoreSettings.has_int_array(_SETTING_TEXT_SCALES):
		return _setting_error("core settings has no integer array " + _SETTING_TEXT_SCALES)
	var scales: PackedInt64Array = CoreSettings.get_int_array(_SETTING_TEXT_SCALES)
	if not scales.has(_DEFAULT_TEXT_SCALE):
		return _setting_error(_SETTING_TEXT_SCALES + " has no 1000")
	for index: int in scales.size():
		if scales[index] < 1:
			return _setting_error(_SETTING_TEXT_SCALES + " has an element less than 1")
		if scales.find(scales[index]) != index:
			return _setting_error(_SETTING_TEXT_SCALES + " has a repeated element")
	if not CoreSettings.has_bool(_SETTING_SUBTITLES_DEFAULT):
		return _setting_error("core settings has no boolean " + _SETTING_SUBTITLES_DEFAULT)
	if not CoreSettings.has_bool(_SETTING_COLOR_FILTER_ENABLED):
		return _setting_error("core settings has no boolean " + _SETTING_COLOR_FILTER_ENABLED)
	if not CoreSettings.has_float_array_map(_SETTING_COLOR_MATRICES):
		return _setting_error("core settings has no object of number arrays " + _SETTING_COLOR_MATRICES)
	var map: Dictionary[String, PackedFloat64Array] = CoreSettings.get_float_array_map(_SETTING_COLOR_MATRICES)
	var matrices: Array[PackedFloat64Array] = [PackedFloat64Array()]
	for mode: int in range(ColorMode.PROTANOPIA, _COLOR_MODE_NAMES.size()):
		var mode_name: String = _COLOR_MODE_NAMES[mode]
		if not map.has(mode_name) or map[mode_name].size() != _MATRIX_SIZE:
			return _setting_error(_SETTING_COLOR_MATRICES + " has no matrix of 9 numbers for " + mode_name)
		for number: float in map[mode_name]:
			if not is_finite(number):
				return _setting_error(_SETTING_COLOR_MATRICES + " has a number that is not finite for " + mode_name)
		matrices.append(map[mode_name])
	if not CoreSettings.has_int(_SETTING_REDUCED_SHAKE) or not CoreSettings.has_int(_SETTING_SUBTITLE_WIDTH):
		return _setting_error("core settings has no integer %s or %s" % [_SETTING_REDUCED_SHAKE, _SETTING_SUBTITLE_WIDTH])
	if not CoreSettings.has_int(_SETTING_SUBTITLE_FONT_SIZE):
		return _setting_error("core settings has no integer " + _SETTING_SUBTITLE_FONT_SIZE)
	var number_keys: PackedStringArray = [
		_SETTING_REDUCED_FLASH, _SETTING_SUBTITLE_OPACITY, _SETTING_SUBTITLE_PADDING, _SETTING_SUBTITLE_MARGIN
	]
	for key: String in number_keys:
		if not CoreSettings.has_float(key):
			return _setting_error("core settings has no number " + key)
	var shake: int = CoreSettings.get_int(_SETTING_REDUCED_SHAKE)
	var width: int = CoreSettings.get_int(_SETTING_SUBTITLE_WIDTH)
	var font_size: int = CoreSettings.get_int(_SETTING_SUBTITLE_FONT_SIZE)
	var flash: float = CoreSettings.get_float(_SETTING_REDUCED_FLASH)
	var opacity: float = CoreSettings.get_float(_SETTING_SUBTITLE_OPACITY)
	var padding: float = CoreSettings.get_float(_SETTING_SUBTITLE_PADDING)
	var margin: float = CoreSettings.get_float(_SETTING_SUBTITLE_MARGIN)
	if shake < 0 or shake > 1000:
		return _setting_error(_SETTING_REDUCED_SHAKE + " is not from 0 to 1000")
	if width < 1 or width > 1000:
		return _setting_error(_SETTING_SUBTITLE_WIDTH + " is not from 1 to 1000")
	if not _is_unit(flash) or not _is_unit(opacity):
		return _setting_error("%s or %s is not from 0 to 1" % [_SETTING_REDUCED_FLASH, _SETTING_SUBTITLE_OPACITY])
	if font_size < 1:
		return _setting_error(_SETTING_SUBTITLE_FONT_SIZE + " is less than 1")
	if not (is_finite(padding) and padding >= 0.0) or not (is_finite(margin) and margin >= 0.0):
		return _setting_error("%s or %s is less than 0" % [_SETTING_SUBTITLE_PADDING, _SETTING_SUBTITLE_MARGIN])
	_text_scales = scales
	_subtitles_default = CoreSettings.get_bool(_SETTING_SUBTITLES_DEFAULT)
	_filter_enabled = CoreSettings.get_bool(_SETTING_COLOR_FILTER_ENABLED)
	_matrices = matrices
	_reduced_shake_permille = shake
	_reduced_flash_max_opacity = flash
	_subtitle_width_permille = width
	_subtitle_box_opacity = opacity
	_subtitle_font_size = font_size
	_subtitle_padding = padding
	_subtitle_bottom_margin = margin
	return true


static func _setting_error(message: String) -> bool:
	LogCore.log_error(_TAG, "init: " + message)
	return false


static func _is_unit(value: float) -> bool:
	return is_finite(value) and value >= 0.0 and value <= 1.0


static func _default_settings() -> AccessibilitySettings:
	var settings: AccessibilitySettings = AccessibilitySettings.new()
	settings.subtitles = _subtitles_default
	return settings


static func _copy(source: AccessibilitySettings) -> AccessibilitySettings:
	var copy: AccessibilitySettings = AccessibilitySettings.new()
	copy.text_scale_permille = source.text_scale_permille
	copy.color_mode = source.color_mode
	copy.subtitles = source.subtitles
	copy.reduce_shake = source.reduce_shake
	copy.reduce_flash = source.reduce_flash
	return copy


static func _publish_changed() -> void:
	var event: AccessibilityChangedEvent = EventCore.acquire(AccessibilityChangedEvent) as AccessibilityChangedEvent
	EventCore.publish(event)


static func _apply_text_scale() -> void:
	LocalizationCore.set_text_scale(_settings.text_scale_permille)


## Shows the filter with the matrix of the color mode, or hides it for `NONE`.
static func _apply_color_mode() -> void:
	if _filter == null:
		return
	var mode: int = _settings.color_mode
	if mode == ColorMode.NONE:
		_filter.visible = false
		return
	var matrix: PackedFloat64Array = _matrices[mode]
	_filter_material.set_shader_parameter(_ROW_R, Vector3(matrix[0], matrix[1], matrix[2]))
	_filter_material.set_shader_parameter(_ROW_G, Vector3(matrix[3], matrix[4], matrix[5]))
	_filter_material.set_shader_parameter(_ROW_B, Vector3(matrix[6], matrix[7], matrix[8]))
	_filter.visible = true


static func _apply_subtitles() -> void:
	if not _settings.subtitles:
		_hide_subtitle()


static func _apply_reduce_shake() -> void:
	var permille: int = _reduced_shake_permille if _settings.reduce_shake else _FULL_SHAKE_PERMILLE
	CameraCore.set_shake_scale(permille)


static func _apply_reduce_flash() -> void:
	var limit: float = _reduced_flash_max_opacity if _settings.reduce_flash else _FULL_FLASH_OPACITY
	ScreenEffectCore.set_flash_opacity_limit(limit)


## The subtitle box: a code-made black rectangle with white wrapped text, hidden until a subtitle is shown. The text
## element gets its size before it enters the tree, so `LocalizationCore` takes it as the size set on the element.
static func _make_subtitle_box(layer: CanvasLayer) -> void:
	var box: ColorRect = ColorRect.new()
	box.name = "AccessibilitySubtitle"
	box.color = Color(0.0, 0.0, 0.0, _subtitle_box_opacity)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.visible = false
	var label: Label = Label.new()
	label.name = "Text"
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_color_override(_FONT_COLOR, Color.WHITE)
	label.add_theme_font_size_override(_FONT_SIZE, _subtitle_font_size)
	box.add_child(label)
	layer.add_child(box)
	_subtitle_box = box
	_subtitle_label = label


## The color filter: a full screen `ColorRect` with the filter shader, above everything else of its layer and outside
## its safe area root. Hidden while the color mode is `NONE`.
static func _make_filter(layer: CanvasLayer) -> void:
	var shader: Shader = Shader.new()
	shader.code = _FILTER_SHADER
	var material: ShaderMaterial = ShaderMaterial.new()
	material.shader = shader
	var filter: ColorRect = ColorRect.new()
	filter.name = "AccessibilityColorFilter"
	filter.material = material
	filter.z_index = RenderingServer.CANVAS_ITEM_Z_MAX
	filter.mouse_filter = Control.MOUSE_FILTER_IGNORE
	filter.focus_mode = Control.FOCUS_NONE
	filter.visible = false
	layer.add_child(filter)
	_filter = filter
	_filter_material = material
	_fit_filter()


## Puts the color filter on the visible game area: the safe area with each edge moved outward by its inset.
static func _fit_filter() -> void:
	if _filter == null:
		return
	var safe: Rect2 = SafeAreaCore.get_safe_area()
	var left: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.LEFT)
	var top: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.TOP)
	var right: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.RIGHT)
	var bottom: float = SafeAreaCore.get_inset(SafeAreaCore.Edge.BOTTOM)
	_filter.position = Vector2(safe.position.x - left, safe.position.y - top)
	_filter.size = Vector2(safe.size.x + left + right, safe.size.y + top + bottom)


## Places the subtitle box: horizontally centered on the safe area, its bottom edge `subtitleBottomMargin` above the
## bottom edge of the safe area, its width the `subtitleWidthPermille` part of the safe area width. Frame code.
static func _layout_subtitle() -> void:
	var area: Rect2 = SafeAreaCore.get_safe_area()
	var width: float = area.size.x * _subtitle_width_permille / 1000.0
	var inner: float = maxf(width - 2.0 * _subtitle_padding, 0.0)
	_subtitle_label.position = Vector2(_subtitle_padding, _subtitle_padding)
	# The wrapped text height depends on the width: set the width first, then drop the minimum size cached at the
	# width before.
	_subtitle_label.size = Vector2(inner, 0.0)
	_subtitle_label.update_minimum_size()
	var text_height: float = _subtitle_label.get_combined_minimum_size().y
	_subtitle_label.size = Vector2(inner, text_height)
	var height: float = text_height + 2.0 * _subtitle_padding
	_subtitle_box.size = Vector2(width, height)
	_subtitle_box.position = Vector2(
		area.position.x + (area.size.x - width) / 2.0, area.end.y - _subtitle_bottom_margin - height
	)


static func _hide_subtitle() -> void:
	_subtitle_handle = SoundCore.INVALID_HANDLE
	if is_instance_valid(_subtitle_box):
		_subtitle_box.visible = false


## Frame check: hides the subtitle once its voice is no longer playing, and keeps the shown box on the safe area.
static func _on_frame() -> void:
	if not _is_initialized or _subtitle_handle == SoundCore.INVALID_HANDLE:
		return
	if not SoundCore.is_initialized() or not SoundCore.is_playing(_subtitle_handle):
		_hide_subtitle()
		return
	_layout_subtitle()


## App exit or tree teardown took the core node out of the tree without `release`.
static func _on_node_exit() -> void:
	if not _is_initialized:
		return
	if is_instance_valid(_node) and EventCore.is_initialized():
		EventCore.unsubscribe_all(_node)
	_clean_up(false)


## `release` and app exit: removes the color filter and the subtitle box and puts every static var back to its initial
## value. `immediate` frees them now; app exit queues the free.
static func _clean_up(immediate: bool) -> void:
	_is_initialized = false
	var elements: Array[Control] = [_filter, _subtitle_box]
	for element: Control in elements:
		if not is_instance_valid(element):
			continue
		var parent: Node = element.get_parent()
		if immediate:
			if parent != null:
				parent.remove_child(element)
			element.free()
		else:
			element.queue_free()
	_reset_state()


static func _reset_state() -> void:
	_is_initialized = false
	_node = null
	_text_scales = PackedInt64Array()
	_subtitles_default = false
	_filter_enabled = false
	_matrices = []
	_reduced_shake_permille = 0
	_reduced_flash_max_opacity = 0.0
	_subtitle_width_permille = 0
	_subtitle_box_opacity = 0.0
	_subtitle_font_size = 0
	_subtitle_padding = 0.0
	_subtitle_bottom_margin = 0.0
	_settings = null
	_filter = null
	_filter_material = null
	_subtitle_box = null
	_subtitle_label = null
	_subtitle_handle = SoundCore.INVALID_HANDLE
