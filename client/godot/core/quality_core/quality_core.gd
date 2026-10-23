class_name QualityCore
extends RefCounted
## Picks the graphics quality level and applies the render scale, shadow and frame limit of its quality profile to the
## engine; `get_profile` gives the effect density. The first level comes from the device class, the level the user
## picks is saved on the device, and the auto downgrade lowers the level by one when the measured FPS stays low.

enum QualityLevel { LOW, MEDIUM, HIGH }
enum ShadowQuality { OFF, LOW, HIGH }

const _TAG: String = "QualityCore"
const _CORE_NODE := preload("res://core/quality_core/quality_core_node.gd")

const _SETTING_TARGET_FPS: String = "targetFps"
const _SETTING_LEVELS: String = "QualityCore.levels"
const _SETTING_DEVICE_CLASSES: String = "QualityCore.deviceClasses"
const _SETTING_AUTO_ENABLED: String = "QualityCore.autoDowngradeEnabled"
const _SETTING_WINDOW: String = "QualityCore.autoDowngradeWindowMs"
const _SETTING_FPS_PERMILLE: String = "QualityCore.autoDowngradeFpsPermille"
const _SETTING_HITCH: String = "QualityCore.hitchFrameMs"
const _INT_SETTINGS: PackedStringArray = [_SETTING_TARGET_FPS, _SETTING_WINDOW, _SETTING_FPS_PERMILLE, _SETTING_HITCH]
## `LocalDataCore` keys of the `device` file.
const _KEY_OVERRIDE: String = "QualityCore.override_level"
const _KEY_AUTO: String = "QualityCore.auto_level"

## Element names by `QualityLevel` and by `ShadowQuality` value.
const _LEVEL_NAMES: PackedStringArray = ["Low", "Medium", "High"]
const _SHADOW_NAMES: PackedStringArray = ["Off", "Low", "High"]
## Device class detection looks at the items of these levels, in this order.
const _DETECTION_ORDER: PackedInt32Array = [QualityLevel.HIGH, QualityLevel.MEDIUM]
const _PERMILLE: int = 1000
## A device value the engine could not read, and a `set_test_device_info` value for it.
const _UNREAD: int = -1

const _SHADOW_FILTER_DIRECTIONAL: String = "rendering/lights_and_shadows/directional_shadow/soft_shadow_filter_quality"
const _SHADOW_FILTER_POSITIONAL: String = "rendering/lights_and_shadows/positional_shadow/soft_shadow_filter_quality"

static var _is_initialized: bool = false
## New at every `init`; deferred work of another session does nothing.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null

# Settings read in `init`.
## Profile of each level, by `QualityLevel` value.
static var _profiles: Array[QualityProfile] = []
## Device class detection items in settings order: level, minimum system memory bytes, minimum processor count.
static var _class_levels: PackedInt32Array = PackedInt32Array()
static var _class_memory: PackedInt64Array = PackedInt64Array()
static var _class_processors: PackedInt64Array = PackedInt64Array()
static var _auto_enabled: bool = false
static var _window_ms: int = 0
static var _fps_permille: int = 0
static var _hitch_ms: int = 0

# Level.
static var _level: QualityLevel = QualityLevel.MEDIUM
static var _override: bool = false
## True once `apply_saved_level` applied a level. The auto downgrade measures only after it.
static var _applied: bool = false

# Engine values before `init`, and the shadow state.
static var _initial_render_scale: float = 1.0
static var _initial_max_fps: int = 0
## True while the applied shadow is `Off`: `Light3D` nodes added to the tree get their shadow turned off.
static var _shadow_off: bool = false
## Original `shadow_enabled` of each `Light3D` the shadow `Off` turned off, by instance ID.
static var _light_shadows: Dictionary[int, bool] = {}

# Auto downgrade measurement.
static var _in_background: bool = false
static var _measured_frames: int = 0
static var _measured_ms: int = 0
## `_on_downgrade_due` bound to the session of `init`; frame code defers it.
static var _downgrade_call: Callable = Callable()

# DEV: `QualityCoreDev`. Only the DEV code and the core tests write them.
## True after `set_test_level`: no auto downgrade until `release`.
static var _test_level_active: bool = false
## True after `set_test_device_info`: device class detection and base FPS use the test values.
static var _test_device_active: bool = false
static var _test_memory_bytes: int = _UNREAD
static var _test_processor_count: int = _UNREAD
static var _test_refresh_rate: int = _UNREAD


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init called while initialized")
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		LogCore.log_error(_TAG, "init found no SceneTree")
		return false
	if not _read_settings():
		_reset()
		return false
	var node: _CORE_NODE = _CORE_NODE.new()
	node.name = _TAG
	tree.root.add_child(node)
	_node = node
	if (
		not EventCore.subscribe(AppBackgroundEnteredEvent, node._on_app_background_entered)
		or not EventCore.subscribe(AppForegroundReturnedEvent, node._on_app_foreground_returned)
	):
		LogCore.log_error(_TAG, "init could not subscribe to the TimeCore background events")
		_clean_up(true)
		return false
	if tree.node_added.connect(node._on_node_added) != OK or tree.node_removed.connect(node._on_node_removed) != OK:
		LogCore.log_error(_TAG, "init could not connect the SceneTree node_added and node_removed signals")
		_clean_up(true)
		return false
	_session = RefCounted.new()
	_downgrade_call = _on_downgrade_due.bind(_session)
	_initial_render_scale = tree.root.scaling_3d_scale
	_initial_max_fps = Engine.max_fps
	_is_initialized = true
	return true


static func release() -> void:
	if not _is_initialized:
		return
	_clean_up(true)


static func is_initialized() -> bool:
	return _is_initialized


## Applies the first level that is there: the saved override level, the saved auto level, then the device class
## detection level, which is saved as the auto level. `BootstrapCore` calls it after `LocalDataCore.load_device_file`.
static func apply_saved_level() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "apply_saved_level called before init")
		return
	var override: bool = false
	var level: int = _saved_level(_KEY_OVERRIDE)
	if level >= 0:
		override = true
	else:
		level = _saved_level(_KEY_AUTO)
	if level < 0:
		level = _detect_level()
		LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_AUTO, _LEVEL_NAMES[level])
	_override = override
	_level = level as QualityLevel
	_applied = true
	_clear_measurement()
	_apply(_level)


static func get_level() -> QualityLevel:
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_level called before init")
		return QualityLevel.MEDIUM
	return _level


## A copy of the profile of the current level.
static func get_profile() -> QualityProfile:
	var profile: QualityProfile = QualityProfile.new()
	if not _is_initialized:
		LogCore.log_error(_TAG, "get_profile called before init")
		return profile
	var source: QualityProfile = _profiles[_level]
	profile.render_scale_permille = source.render_scale_permille
	profile.shadow = source.shadow
	profile.effect_density_permille = source.effect_density_permille
	profile.frame_limit_fps = source.frame_limit_fps
	return profile


## Whether the level the user picked is used.
static func is_override() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_override called before init")
		return false
	return _override


## Applies `level`, saves it as the override level and turns the override state on.
static func set_level(level: QualityLevel) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_level called before init")
		return false
	if not _is_level(level):
		LogCore.log_error(_TAG, "set_level got a value outside QualityLevel: %d; the level stays" % level)
		return false
	LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_OVERRIDE, _LEVEL_NAMES[level])
	_override = true
	_clear_measurement()
	_change_level(level)
	return true


## Deletes the saved override level and applies the saved auto level, or the device class detection level when there
## is none. Does nothing outside the override state.
static func clear_override() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "clear_override called before init")
		return
	if not _override:
		return
	LocalDataCore.remove_value(LocalDataCore.FileKind.DEVICE, _KEY_OVERRIDE)
	_override = false
	_clear_measurement()
	var level: int = _saved_level(_KEY_AUTO)
	if level < 0:
		level = _detect_level()
	_change_level(level as QualityLevel)


# Internal: settings.


static func _read_settings() -> bool:
	for key: String in _INT_SETTINGS:
		if not CoreSettings.has_int(key):
			LogCore.log_error(_TAG, "init found no integer setting " + key)
			return false
	if not CoreSettings.has_bool(_SETTING_AUTO_ENABLED):
		LogCore.log_error(_TAG, "init found no boolean core setting " + _SETTING_AUTO_ENABLED)
		return false
	var window_ms: int = CoreSettings.get_int(_SETTING_WINDOW)
	var fps_permille: int = CoreSettings.get_int(_SETTING_FPS_PERMILLE)
	var hitch_ms: int = CoreSettings.get_int(_SETTING_HITCH)
	if window_ms < 0 or fps_permille < 0 or fps_permille > _PERMILLE or hitch_ms < 0:
		LogCore.log_error(_TAG, "init found a core setting out of range")
		return false
	if not _read_levels(CoreSettings.get_json(_SETTING_LEVELS), CoreSettings.get_int(_SETTING_TARGET_FPS)):
		return false
	if not _read_device_classes(CoreSettings.get_json(_SETTING_DEVICE_CLASSES)):
		return false
	_auto_enabled = CoreSettings.get_bool(_SETTING_AUTO_ENABLED)
	_window_ms = window_ms
	_fps_permille = fps_permille
	_hitch_ms = hitch_ms
	return true


## Reads `QualityCore.levels` from its JSON text into `_profiles`. `frame_limit_fps` is `target_fps` ×
## `frameLimitPermille` ÷ 1000 floored, and 1 when that is below 1.
# ogw:input_boundary
static func _read_levels(text: String, target_fps: int) -> bool:
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		LogCore.log_error(_TAG, "init found no object core setting " + _SETTING_LEVELS)
		return false
	var levels: Dictionary = parsed
	var profiles: Array[QualityProfile] = []
	for level_name: String in _LEVEL_NAMES:
		var item: Variant = levels.get(level_name)
		if not item is Dictionary:
			LogCore.log_error(_TAG, "init found no item %s in %s" % [level_name, _SETTING_LEVELS])
			return false
		var fields: Dictionary = item
		var render_scale: int = _int_field(fields, "renderScalePermille")
		var effect_density: int = _int_field(fields, "effectDensityPermille")
		var frame_limit: int = _int_field(fields, "frameLimitPermille")
		var shadow_value: Variant = fields.get("shadow")
		var shadow: int = -1
		if shadow_value is String:
			var shadow_name: String = shadow_value
			shadow = _SHADOW_NAMES.find(shadow_name)
		if (
			shadow < 0
			or render_scale < 1 or render_scale > _PERMILLE
			or frame_limit < 1 or frame_limit > _PERMILLE
			or effect_density < 0 or effect_density > _PERMILLE
		):
			LogCore.log_error(_TAG, "init found an invalid value in item %s of %s" % [level_name, _SETTING_LEVELS])
			return false
		var profile: QualityProfile = QualityProfile.new()
		profile.render_scale_permille = render_scale
		profile.shadow = shadow as ShadowQuality
		profile.effect_density_permille = effect_density
		profile.frame_limit_fps = maxi(target_fps * frame_limit / _PERMILLE, 1)
		profiles.append(profile)
	_profiles = profiles
	return true


## Reads `QualityCore.deviceClasses` from its JSON text.
# ogw:input_boundary
static func _read_device_classes(text: String) -> bool:
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Array:
		LogCore.log_error(_TAG, "init found no array core setting " + _SETTING_DEVICE_CLASSES)
		return false
	var items: Array = parsed
	var levels: PackedInt32Array = PackedInt32Array()
	var memory: PackedInt64Array = PackedInt64Array()
	var processors: PackedInt64Array = PackedInt64Array()
	for item: Variant in items:
		var level: int = -1
		var min_memory: int = -1
		var min_processors: int = -1
		if item is Dictionary:
			var fields: Dictionary = item
			var level_value: Variant = fields.get("level")
			if level_value is String:
				var level_name: String = level_value
				level = _LEVEL_NAMES.find(level_name)
			min_memory = _int_field(fields, "minMemoryBytes")
			min_processors = _int_field(fields, "minProcessorCount")
		if (level != QualityLevel.MEDIUM and level != QualityLevel.HIGH) or min_memory < 0 or min_processors < 0:
			LogCore.log_error(_TAG, "init found an invalid item in " + _SETTING_DEVICE_CLASSES)
			return false
		levels.append(level)
		memory.append(min_memory)
		processors.append(min_processors)
	_class_levels = levels
	_class_memory = memory
	_class_processors = processors
	return true


## The value of `name` in `fields` when it is an integer of 0 or more, else -1.
# ogw:input_boundary
static func _int_field(fields: Dictionary, name: String) -> int:
	var value: Variant = fields.get(name)
	if value is int:
		var whole: int = value
		return whole if whole >= 0 else -1
	if value is float:
		var number: float = value
		if is_finite(number) and number >= 0.0 and number == floorf(number):
			return int(number)
	return -1


# Internal: level.


static func _is_level(level: int) -> bool:
	return level >= QualityLevel.LOW and level <= QualityLevel.HIGH


## The `QualityLevel` value saved at `key` of the `device` file. -1 when there is none, and after a warn log when the
## saved value is no `QualityLevel` element name.
static func _saved_level(key: String) -> int:
	var saved: String = LocalDataCore.get_value_string(LocalDataCore.FileKind.DEVICE, key, "")
	if saved.is_empty():
		return -1
	var level: int = _LEVEL_NAMES.find(saved)
	if level < 0:
		LogCore.log_warn(_TAG, "saved %s is no QualityLevel element name: %s" % [key, saved])
	return level


## The level of the first device class item, items of `High` first, then `Medium`, whose minimum system memory and
## processor count the device reaches. A device value the engine could not read passes. `Low` when no item matches.
static func _detect_level() -> int:
	var memory: int = _test_memory_bytes if _test_device_active else _read_memory_bytes()
	var processors: int = _test_processor_count if _test_device_active else OS.get_processor_count()
	for level: int in _DETECTION_ORDER:
		for i: int in _class_levels.size():
			if _class_levels[i] != level:
				continue
			var memory_passes: bool = memory == _UNREAD or memory >= _class_memory[i]
			var processors_pass: bool = processors == _UNREAD or processors >= _class_processors[i]
			if memory_passes and processors_pass:
				return level
	return QualityLevel.LOW


## System memory bytes of the device, -1 when the engine could not read it.
# ogw:input_boundary
static func _read_memory_bytes() -> int:
	var info: Dictionary = OS.get_memory_info()
	var physical: Variant = info.get("physical", _UNREAD)
	if not physical is int:
		return _UNREAD
	var bytes: int = physical
	return bytes if bytes >= 0 else _UNREAD


## Refresh rate of the device screen in whole Hz, -1 when the engine could not read it.
static func _read_refresh_rate() -> int:
	if _test_device_active:
		return _test_refresh_rate
	var rate: int = floori(DisplayServer.screen_get_refresh_rate())
	return rate if rate > 0 else _UNREAD


## Applies `level` and publishes `QualityChangedEvent` when it is not the current level.
static func _change_level(level: QualityLevel) -> void:
	if level == _level:
		return
	_level = level
	_clear_measurement()
	_apply(level)
	var event := EventCore.acquire(QualityChangedEvent) as QualityChangedEvent
	if event != null:
		event.level = level
		EventCore.publish(event)


# Internal: engine.


## Applies the render scale, the shadow and the frame limit of the profile of `level`, in the same frame.
static func _apply(level: QualityLevel) -> void:
	var profile: QualityProfile = _profiles[level]
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree != null:
		tree.root.scaling_3d_scale = float(profile.render_scale_permille) / float(_PERMILLE)
	_apply_shadow(profile.shadow, tree)
	Engine.max_fps = profile.frame_limit_fps


static func _apply_shadow(shadow: ShadowQuality, tree: SceneTree) -> void:
	if shadow == ShadowQuality.OFF:
		_shadow_off = true
		if tree != null:
			for node: Node in tree.root.find_children("*", "Light3D", true, false):
				var light: Light3D = node as Light3D
				if light != null:
					_turn_off_shadow(light)
		return
	_shadow_off = false
	_restore_shadows()
	var quality: RenderingServer.ShadowQuality = RenderingServer.SHADOW_QUALITY_SOFT_HIGH
	if shadow == ShadowQuality.LOW:
		quality = RenderingServer.SHADOW_QUALITY_HARD
	RenderingServer.directional_soft_shadow_filter_set_quality(quality)
	RenderingServer.positional_soft_shadow_filter_set_quality(quality)


static func _turn_off_shadow(light: Light3D) -> void:
	var id: int = light.get_instance_id()
	if not _light_shadows.has(id):
		_light_shadows[id] = light.shadow_enabled
	light.shadow_enabled = false


## Puts back the original `shadow_enabled` of every `Light3D` the shadow `Off` turned off.
static func _restore_shadows() -> void:
	for id: int in _light_shadows:
		if is_instance_id_valid(id):
			var light: Light3D = instance_from_id(id) as Light3D
			if light != null:
				light.shadow_enabled = _light_shadows[id]
	_light_shadows.clear()


## Puts the render scale, the shadow and the frame limit back to their values before `init`.
static func _restore_engine(tree: SceneTree) -> void:
	_restore_shadows()
	if tree != null:
		tree.root.scaling_3d_scale = _initial_render_scale
	Engine.max_fps = _initial_max_fps
	RenderingServer.directional_soft_shadow_filter_set_quality(_project_shadow_quality(_SHADOW_FILTER_DIRECTIONAL))
	RenderingServer.positional_soft_shadow_filter_set_quality(_project_shadow_quality(_SHADOW_FILTER_POSITIONAL))


# ogw:input_boundary
static func _project_shadow_quality(setting: String) -> RenderingServer.ShadowQuality:
	var value: Variant = ProjectSettings.get_setting_with_override(setting)
	if value is int:
		var quality: int = value
		if quality >= RenderingServer.SHADOW_QUALITY_HARD and quality < RenderingServer.SHADOW_QUALITY_MAX:
			return quality as RenderingServer.ShadowQuality
	return RenderingServer.SHADOW_QUALITY_SOFT_LOW


# Internal: auto downgrade.


## Whether the auto downgrade measures frames now.
static func _is_measuring() -> bool:
	return (
		_is_initialized and _applied and _auto_enabled and not _override and not _test_level_active
		and _level != QualityLevel.LOW
	)


static func _clear_measurement() -> void:
	_measured_frames = 0
	_measured_ms = 0


## Frame code. Measures the frame when the auto downgrade measures and the app is not in the background; a frame
## longer than `hitchFrameMs` is dropped. When the measured time reaches the window, compares the average FPS with the
## base FPS and defers the downgrade.
static func _on_frame() -> void:
	if not _is_measuring() or not TimeCore.is_initialized():
		_clear_measurement()
		return
	if _in_background:
		return
	var frame_ms: int = TimeCore.get_real_frame_ms()
	if frame_ms > _hitch_ms:
		return
	_measured_frames += 1
	_measured_ms += frame_ms
	if _measured_ms < _window_ms:
		return
	var frames: int = _measured_frames
	var measured_ms: int = _measured_ms
	_clear_measurement()
	var base_fps: int = _profiles[_level].frame_limit_fps
	var refresh_rate: int = _read_refresh_rate()
	if refresh_rate != _UNREAD and refresh_rate < base_fps:
		base_fps = refresh_rate
	# Average FPS = frames ÷ (ms ÷ 1000) < base FPS × permille ÷ 1000, without division.
	if frames * _PERMILLE * _PERMILLE < base_fps * _fps_permille * measured_ms:
		_downgrade_call.call_deferred()


## Lowers the level by one and saves it as the auto level, when the auto downgrade still measures.
static func _on_downgrade_due(session: RefCounted) -> void:
	if session != _session or not _is_measuring():
		return
	var lower: QualityLevel = (_level - 1) as QualityLevel
	LocalDataCore.set_value_string(LocalDataCore.FileKind.DEVICE, _KEY_AUTO, _LEVEL_NAMES[lower])
	_change_level(lower)


static func _on_app_background_entered() -> void:
	_in_background = true


static func _on_app_foreground_returned() -> void:
	_in_background = false
	_clear_measurement()


static func _on_node_added(node: Node) -> void:
	if not _shadow_off:
		return
	var light: Light3D = node as Light3D
	if light != null:
		_turn_off_shadow(light)


static func _on_node_removed(node: Node) -> void:
	if _light_shadows.is_empty():
		return
	var id: int = node.get_instance_id()
	if not _light_shadows.has(id):
		return
	var light: Light3D = node as Light3D
	if light != null:
		light.shadow_enabled = _light_shadows[id]
	_light_shadows.erase(id)


# Internal: lifecycle and DEV.


## The core node left the tree outside `release`: app exit or tree teardown. Cleans up as `release` does.
static func _on_node_exit(node: Node) -> void:
	if not _is_initialized or node != _node:
		return
	_clean_up(false)


static func _clean_up(detach: bool) -> void:
	var node: _CORE_NODE = _node
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if node != null and is_instance_valid(node):
		if EventCore.is_initialized():
			EventCore.unsubscribe_all(node)
		if tree != null:
			if tree.node_added.is_connected(node._on_node_added):
				tree.node_added.disconnect(node._on_node_added)
			if tree.node_removed.is_connected(node._on_node_removed):
				tree.node_removed.disconnect(node._on_node_removed)
		if detach and node.get_parent() != null:
			node.get_parent().remove_child(node)
		node.queue_free()
	if _is_initialized:
		_restore_engine(tree)
	_reset()


## Puts every static var back to its declared value.
static func _reset() -> void:
	_is_initialized = false
	_session = null
	_node = null
	_profiles = []
	_class_levels = PackedInt32Array()
	_class_memory = PackedInt64Array()
	_class_processors = PackedInt64Array()
	_auto_enabled = false
	_window_ms = 0
	_fps_permille = 0
	_hitch_ms = 0
	_level = QualityLevel.MEDIUM
	_override = false
	_applied = false
	_initial_render_scale = 1.0
	_initial_max_fps = 0
	_shadow_off = false
	_light_shadows = {}
	_in_background = false
	_measured_frames = 0
	_measured_ms = 0
	_downgrade_call = Callable()
	_test_level_active = false
	_test_device_active = false
	_test_memory_bytes = _UNREAD
	_test_processor_count = _UNREAD
	_test_refresh_rate = _UNREAD


## DEV: applies `level` without saving it and stops the auto downgrade until `release`.
static func _set_test_level(level: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_test_level called before init")
		return
	if not _is_level(level):
		LogCore.log_error(_TAG, "set_test_level got a value outside QualityLevel: %d; ignored" % level)
		return
	_test_level_active = true
	_clear_measurement()
	_level = level as QualityLevel
	_apply(_level)


## DEV: device values for the device class detection and the base FPS. -1 is a value the engine could not read.
static func _set_test_device_info(memory_bytes: int, processor_count: int, refresh_rate: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_test_device_info called before init")
		return
	if (
		memory_bytes < _UNREAD or processor_count < _UNREAD or refresh_rate < _UNREAD
		or processor_count == 0 or refresh_rate == 0
	):
		LogCore.log_error(_TAG, "set_test_device_info got a value below -1, a processor count of 0 or a refresh rate of 0; ignored")
		return
	_test_device_active = true
	_test_memory_bytes = memory_bytes
	_test_processor_count = processor_count
	_test_refresh_rate = refresh_rate
