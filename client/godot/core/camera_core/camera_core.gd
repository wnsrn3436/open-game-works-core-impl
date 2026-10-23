class_name CameraCore
extends RefCounted
## The game camera that shows the world of a scene: following, camera shake, zoom, screen bounds, and the conversion
## between game coordinates and world positions. UI layers are not affected by the game camera.
## World positions are `Vector3`: x, y for a 2D camera (z is not used and is 0 in results), the engine axes for a 3D
## camera, whose up axis is Y and whose horizontal axes are X and Z. Bounds are a `Rect2` of x, y for a 2D camera and
## of x, z for a 3D camera.

enum CameraMoveResult { COMPLETED, CANCELLED, FAILED }

const _TAG: String = "CameraCore"
const _MIN_ZOOM_KEY: String = "CameraCore.minZoom"
const _MAX_ZOOM_KEY: String = "CameraCore.maxZoom"
const _SHAKE_MAX_OFFSET_KEY: String = "CameraCore.shakeMaxOffset"
const _SHAKE_MAX_ROTATION_KEY: String = "CameraCore.shakeMaxRotationDeg"
const _SHAKE_FREQUENCY_KEY: String = "CameraCore.shakeFrequencyHz"
const _SHAKE_DECAY_KEY: String = "CameraCore.shakeDecayPerSecond"
const _MAX_DURATION_KEY: String = "TweenCore.maxDurationMs"
## Number keys read in `init`.
const _NUMBER_KEYS: PackedStringArray = [
	_MIN_ZOOM_KEY, _MAX_ZOOM_KEY, _SHAKE_MAX_OFFSET_KEY, _SHAKE_MAX_ROTATION_KEY, _SHAKE_FREQUENCY_KEY, _SHAKE_DECAY_KEY,
]
const _CORE_NODE := preload("res://core/camera_core/camera_core_node.gd")
const _MOVE := preload("res://core/camera_core/camera_move.gd")

const _FULL_SHAKE_SCALE: int = 1000
## A ray whose up component is smaller than this in size does not meet the height 0 plane.
const _PARALLEL_EPSILON: float = 0.000001
## Trauma below this after a decay is 0: the decay steps of the frames add up to 1 / `CameraCore.shakeDecayPerSecond`
## seconds with a float remainder.
const _TRAUMA_EPSILON: float = 0.000000001
## Most noise values drawn in one frame: values older than the last two are not used.
const _MAX_NOISE_DRAWS: int = 2

static var _is_initialized: bool = false
## New at every `init`; an async operation that comes back to another session returns `FAILED`.
static var _session: RefCounted = null
static var _node: _CORE_NODE = null

# Settings read in `init`.
static var _min_zoom: float = 0.0
static var _max_zoom: float = 0.0
static var _shake_max_offset: float = 0.0
static var _shake_max_rotation_deg: float = 0.0
static var _shake_frequency_hz: float = 0.0
static var _shake_decay_per_second: float = 0.0
static var _max_duration_ms: int = 0

## `TimeCore` real elapsed time and game time seen by the last frame processing.
static var _last_real_ms: int = 0
static var _last_game_ms: int = 0

# Attached camera. `_camera_id` 0 is no camera.
static var _camera_id: int = 0
static var _camera_2d: Camera2D = null
static var _camera_3d: Camera3D = null
## Reference position: the camera position without the shake offset.
static var _base: Vector3 = Vector3.ZERO
## Zoom factor.
static var _zoom: float = 1.0
## Camera values at zoom factor 1 and without shake rotation, taken when the camera was attached.
static var _zoom_one_2d: Vector2 = Vector2.ONE
static var _rotation_2d: float = 0.0
static var _fov_tan_one: float = 0.0
static var _size_one: float = 0.0
## The bounds fitting error of a 3D camera corner without an intersection is logged once per attached camera.
static var _bounds_error_logged: bool = false

# Follow. `_follow_id` 0 is no follow.
static var _follow_id: int = 0
static var _follow_2d: Node2D = null
static var _follow_3d: Node3D = null
static var _follow_offset: Vector3 = Vector3.ZERO
static var _follow_smooth_ms: int = 0
static var _follow_dead_zone: Vector3 = Vector3.ZERO

## Running `move_to` or `move_by_preset`, and running `zoom_to`.
static var _move: _MOVE = null
static var _zoom_move: _MOVE = null

static var _has_bounds: bool = false
static var _bounds: Rect2 = Rect2()
## View range of the reference position relative to it, on the two bounds axes. Set by `_view_extents`.
static var _extent_min: Vector2 = Vector2.ZERO
static var _extent_max: Vector2 = Vector2.ZERO

# Shake.
static var _trauma: float = 0.0
## Shake scale, permille. Kept while cameras are attached and detached.
static var _shake_scale: int = _FULL_SHAKE_SCALE
static var _random: UtilRandom = null
## Real elapsed time of the noise since its seed, ms. It runs while there is trauma.
static var _noise_elapsed_ms: int = 0
## Number of noise values drawn after the first two since the seed.
static var _noise_step: int = 0
## Noise values the current noise lies between: x and y axes, and z axis (3D) or rotation (2D).
static var _noise_from: Vector3 = Vector3.ZERO
static var _noise_to: Vector3 = Vector3.ZERO
## Applied shake offset (world units) and 2D shake rotation (radians), after the shake scale.
static var _shake_offset: Vector3 = Vector3.ZERO
static var _shake_rotation: float = 0.0


static func init() -> bool:
	if _is_initialized:
		LogCore.log_error(_TAG, "init: already initialized")
		return false
	for key: String in _NUMBER_KEYS:
		if not CoreSettings.has_float(key):
			LogCore.log_error(_TAG, "init: core settings key " + key + " is missing or not a number")
			return false
	if not CoreSettings.has_int(_MAX_DURATION_KEY):
		LogCore.log_error(_TAG, "init: core settings key TweenCore.maxDurationMs is missing or not an integer")
		return false
	if (
		not EventCore.is_initialized() or not TimeCore.is_initialized() or not ResolutionCore.is_initialized()
		or not TweenCore.is_initialized()
	):
		LogCore.log_error(_TAG, "init: EventCore, TimeCore, ResolutionCore or TweenCore is not initialized")
		return false
	_min_zoom = CoreSettings.get_float(_MIN_ZOOM_KEY)
	_max_zoom = CoreSettings.get_float(_MAX_ZOOM_KEY)
	_shake_max_offset = CoreSettings.get_float(_SHAKE_MAX_OFFSET_KEY)
	_shake_max_rotation_deg = CoreSettings.get_float(_SHAKE_MAX_ROTATION_KEY)
	_shake_frequency_hz = CoreSettings.get_float(_SHAKE_FREQUENCY_KEY)
	_shake_decay_per_second = CoreSettings.get_float(_SHAKE_DECAY_KEY)
	_max_duration_ms = CoreSettings.get_int(_MAX_DURATION_KEY)
	_session = RefCounted.new()
	_last_real_ms = TimeCore.get_real_time()
	_last_game_ms = TimeCore.get_game_time()
	_reseed(TimeCore.get_device_time() ^ TimeCore.get_monotonic_time())
	var node: _CORE_NODE = _CORE_NODE.new()
	_node = node
	_is_initialized = true
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	return true


static func release() -> void:
	if not _is_initialized:
		return
	var node: _CORE_NODE = _node
	if is_instance_valid(node):
		node.released = true
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()
	_clean_up()


static func is_initialized() -> bool:
	return _is_initialized


## Attaches `camera` (a `Camera2D` or `Camera3D`) as the game camera after detaching the attached one. The camera
## position becomes the reference position and the zoom factor 1. A `Camera2D` gets the settings the camera control
## needs: center anchor, rotation, no offset, smoothing, drag margins or engine limits.
# ogw:input_boundary
static func attach_camera(camera: Variant) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "attach_camera: not initialized")
		return false
	if typeof(camera) != TYPE_OBJECT or not is_instance_valid(camera) or not (camera is Camera2D or camera is Camera3D):
		LogCore.log_error(_TAG, "attach_camera: the object is missing, destroyed or not an engine camera")
		return false
	# The previous moves end after the new camera is set: a caller resumed by the cancel sees the new camera.
	var previous: _MOVE = _take_move()
	var previous_zoom: _MOVE = _take_zoom_move()
	_clear_camera()
	var object: Object = camera
	_camera_id = object.get_instance_id()
	_zoom = 1.0
	if object is Camera2D:
		var camera_2d: Camera2D = object as Camera2D
		_camera_2d = camera_2d
		camera_2d.anchor_mode = Camera2D.ANCHOR_MODE_DRAG_CENTER
		camera_2d.ignore_rotation = false
		camera_2d.offset = Vector2.ZERO
		camera_2d.position_smoothing_enabled = false
		camera_2d.rotation_smoothing_enabled = false
		camera_2d.drag_horizontal_enabled = false
		camera_2d.drag_vertical_enabled = false
		camera_2d.limit_enabled = false
		_zoom_one_2d = camera_2d.zoom
		_rotation_2d = camera_2d.rotation
		var position_2d: Vector2 = camera_2d.global_position if camera_2d.is_inside_tree() else camera_2d.position
		_base = Vector3(position_2d.x, position_2d.y, 0.0)
	else:
		var camera_3d: Camera3D = object as Camera3D
		_camera_3d = camera_3d
		if camera_3d.projection == Camera3D.PROJECTION_PERSPECTIVE:
			_fov_tan_one = tan(deg_to_rad(camera_3d.fov) / 2.0)
		else:
			_size_one = camera_3d.size
		_base = camera_3d.global_position if camera_3d.is_inside_tree() else camera_3d.position
	_cancel_moves(previous, previous_zoom)
	return true


## Detaches the game camera: follow, `move_to`, `zoom_to`, shake and bounds end. A running `move_to` and `zoom_to`
## end with `CANCELLED`. The camera keeps the reference position without the shake offset.
static func detach_camera() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "detach_camera: not initialized")
		return
	_detach_camera()


## Whether a camera is attached. A destroyed camera is detached first.
static func has_camera() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "has_camera: not initialized")
		return false
	return _has_camera()


## Whether the attached camera is a 3D camera (`Camera3D`). False without a camera; a destroyed camera is detached
## first.
static func is_3d_camera() -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, "is_3d_camera: not initialized")
		return false
	return _has_camera() and _camera_3d != null


## Follows `target` (a `Node2D` for a 2D camera, a `Node3D` for a 3D camera) with `options`. `null` options are the
## default `FollowOptions`. A running `move_to` ends with `CANCELLED`.
# ogw:input_boundary
static func follow(target: Variant, options: FollowOptions) -> bool:
	if not _check_camera("follow"):
		return false
	var used: FollowOptions = options if options != null else FollowOptions.new()
	if typeof(target) != TYPE_OBJECT or not is_instance_valid(target):
		LogCore.log_error(_TAG, "follow: the target object is missing or destroyed")
		return false
	var object: Object = target
	if (_camera_3d != null and not object is Node3D) or (_camera_2d != null and not object is Node2D):
		LogCore.log_error(_TAG, "follow: the target object is not a Node2D for a 2D camera or a Node3D for a 3D camera")
		return false
	if used.smooth_time_ms < 0:
		LogCore.log_error(_TAG, "follow: the smooth time is negative")
		return false
	if not _is_finite_vector(used.offset) or not _is_finite_vector(used.dead_zone):
		LogCore.log_error(_TAG, "follow: the offset or the dead zone is NaN or infinite")
		return false
	if used.dead_zone.x < 0.0 or used.dead_zone.y < 0.0 or used.dead_zone.z < 0.0:
		LogCore.log_error(_TAG, "follow: an axis of the dead zone is negative")
		return false
	var previous: _MOVE = _take_move()
	_follow_id = object.get_instance_id()
	_follow_2d = object as Node2D
	_follow_3d = object as Node3D
	_follow_offset = _on_axes(used.offset)
	_follow_smooth_ms = used.smooth_time_ms
	_follow_dead_zone = used.dead_zone
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)
	return true


static func stop_follow() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "stop_follow: not initialized")
		return
	_end_follow()


## Async. Moves the reference position from where it is to `position` over `duration_ms` with `easing`, progressing
## on `time_basis`. Follow ends; a running `move_to` ends with `CANCELLED`.
static func move_to(
	position: Vector3, duration_ms: int, easing: TweenCore.Easing, time_basis: TweenCore.TimeBasis
) -> CameraMoveResult:
	if not _check_camera("move_to"):
		return CameraMoveResult.FAILED
	if not _is_finite_vector(position):
		LogCore.log_error(_TAG, "move_to: the position is NaN or infinite")
		return CameraMoveResult.FAILED
	if not _check_timing("move_to", duration_ms, easing, time_basis):
		return CameraMoveResult.FAILED
	var move: _MOVE = _begin_move()
	_start_move(move, _on_axes(position), duration_ms, easing, time_basis)
	return await _wait(move)


## Async. Loads the tween preset `key` with `scope` and does `move_to` to `position` with the duration and easing of
## its first step's first change, on game time. While the preset loads it is the running `move_to`.
static func move_by_preset(position: Vector3, key: String, scope: Scope) -> CameraMoveResult:
	if not _check_camera("move_by_preset"):
		return CameraMoveResult.FAILED
	if not _is_finite_vector(position):
		LogCore.log_error(_TAG, "move_by_preset: the position is NaN or infinite")
		return CameraMoveResult.FAILED
	var move: _MOVE = _begin_move()
	if not move.done:
		move.pending = true
		_load_preset(move, _on_axes(position), key, scope, _session)
	return await _wait(move)


## Ends the running `move_to` with `CANCELLED`. The reference position stays where it is. Follow does not change.
static func stop_move() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "stop_move: not initialized")
		return
	var previous: _MOVE = _take_move()
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)


## Ends follow and the running `move_to` (`CANCELLED`) and puts the reference position at `position` at once.
static func snap_to(position: Vector3) -> bool:
	if not _check_camera("snap_to"):
		return false
	if not _is_finite_vector(position):
		LogCore.log_error(_TAG, "snap_to: the position is NaN or infinite")
		return false
	var previous: _MOVE = _take_move()
	_end_follow()
	_base = _on_axes(position)
	_apply_now()
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)
	return true


## Async. Changes the zoom factor from where it is to `zoom`, kept in `CameraCore.minZoom`..`CameraCore.maxZoom`, over
## `duration_ms` with `easing`, progressing on `time_basis`. A running `zoom_to` ends with `CANCELLED`.
static func zoom_to(
	zoom: float, duration_ms: int, easing: TweenCore.Easing, time_basis: TweenCore.TimeBasis
) -> CameraMoveResult:
	if not _check_camera("zoom_to"):
		return CameraMoveResult.FAILED
	if not is_finite(zoom) or zoom <= 0.0:
		LogCore.log_error(_TAG, "zoom_to: the zoom factor is not a number above 0")
		return CameraMoveResult.FAILED
	if not _check_timing("zoom_to", duration_ms, easing, time_basis):
		return CameraMoveResult.FAILED
	var move: _MOVE = _MOVE.new()
	var previous: _MOVE = _zoom_move
	_zoom_move = move
	move.easing = easing
	move.time_basis = time_basis
	move.duration_ms = duration_ms
	move.start_time = _now(time_basis)
	move.start_value = Vector3(_zoom, 0.0, 0.0)
	move.end_value = Vector3(clampf(zoom, _min_zoom, _max_zoom), 0.0, 0.0)
	if duration_ms == 0:
		_zoom = move.end_value.x
		_apply_now()
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)
	if duration_ms == 0:
		_finish(move, CameraMoveResult.COMPLETED)
	return await _wait(move)


static func get_zoom() -> float:
	if not _check_camera("get_zoom"):
		return 1.0
	return _zoom


## Sets the screen bounds: the view range stays inside `bounds` (x, y for a 2D camera, x, z for a 3D camera).
static func set_bounds(bounds: Rect2) -> bool:
	if not _check_camera("set_bounds"):
		return false
	if not is_finite(bounds.position.x) or not is_finite(bounds.position.y) or not is_finite(bounds.size.x) \
			or not is_finite(bounds.size.y):
		LogCore.log_error(_TAG, "set_bounds: a bounds value is NaN or infinite")
		return false
	if bounds.size.x <= 0.0 or bounds.size.y <= 0.0:
		LogCore.log_error(_TAG, "set_bounds: an axis of the bounds size is 0 or less")
		return false
	_has_bounds = true
	_bounds = bounds
	return true


static func clear_bounds() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "clear_bounds: not initialized")
		return
	_has_bounds = false
	_bounds = Rect2()


## Adds `amount` to the trauma, cut at 1, and publishes `CameraShakeStartedEvent`.
static func shake(amount: float) -> void:
	if not _check_camera("shake"):
		return
	if not is_finite(amount) or amount <= 0.0:
		LogCore.log_error(_TAG, "shake: the amount is not a number above 0")
		return
	_trauma = minf(1.0, _trauma + amount)
	if EventCore.is_initialized():
		var event: CameraShakeStartedEvent = EventCore.acquire(CameraShakeStartedEvent) as CameraShakeStartedEvent
		if event != null:
			EventCore.publish(event)


## Puts the trauma at 0 and removes the shake offset and rotation at once.
static func stop_shake() -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "stop_shake: not initialized")
		return
	_trauma = 0.0
	_shake_offset = Vector3.ZERO
	_shake_rotation = 0.0
	if _has_camera() and _camera_inside_tree():
		_apply_transform()


## Sets the shake scale, permille 0..1000. Works without a camera.
static func set_shake_scale(permille: int) -> void:
	if not _is_initialized:
		LogCore.log_error(_TAG, "set_shake_scale: not initialized")
		return
	if permille < 0 or permille > _FULL_SHAKE_SCALE:
		LogCore.log_error(_TAG, "set_shake_scale: the shake scale is not 0..1000")
		return
	_shake_scale = permille


## The reference position fitted to the bounds, without the shake offset. For a 3D camera the camera position.
static func get_view_center() -> Vector3:
	if not _check_camera("get_view_center"):
		return Vector3.ZERO
	return _base


## The world position at the game coordinates `position`. For a 3D camera the point where the camera ray through it
## meets the height 0 plane.
static func screen_to_world(position: Vector2) -> Vector3:
	if not _check_camera("screen_to_world"):
		return Vector3.ZERO
	if not is_finite(position.x) or not is_finite(position.y):
		LogCore.log_error(_TAG, "screen_to_world: the position is NaN or infinite")
		return Vector3.ZERO
	if not _camera_inside_tree():
		LogCore.log_error(_TAG, "screen_to_world: the camera is not in the scene tree")
		return Vector3.ZERO
	if _camera_2d != null:
		var world: Vector2 = (
			_camera_2d.global_position
			+ ((position - _half_view()) / _camera_2d.zoom).rotated(_camera_2d.global_rotation)
		)
		return Vector3(world.x, world.y, 0.0)
	var origin: Vector3 = _camera_3d.project_ray_origin(position)
	var normal: Vector3 = _camera_3d.project_ray_normal(position)
	var distance: float = _ray_to_ground(origin, normal)
	if distance < 0.0:
		LogCore.log_error(_TAG, "screen_to_world: the camera ray does not meet the height 0 plane")
		return Vector3.ZERO
	return origin + normal * distance


## The game coordinates of the world position `position`. For a 3D camera the origin, with an error log, when the
## position is not beyond the near plane.
static func world_to_screen(position: Vector3) -> Vector2:
	if not _check_camera("world_to_screen"):
		return Vector2.ZERO
	if not _is_finite_vector(position):
		LogCore.log_error(_TAG, "world_to_screen: the position is NaN or infinite")
		return Vector2.ZERO
	if not _camera_inside_tree():
		LogCore.log_error(_TAG, "world_to_screen: the camera is not in the scene tree")
		return Vector2.ZERO
	if _camera_2d != null:
		var relative: Vector2 = Vector2(position.x, position.y) - _camera_2d.global_position
		return _half_view() + relative.rotated(-_camera_2d.global_rotation) * _camera_2d.zoom
	if _camera_3d.is_position_behind(position):
		LogCore.log_error(_TAG, "world_to_screen: the position is not beyond the near plane of the camera")
		return Vector2.ZERO
	return _camera_3d.unproject_position(position)


# Lifecycle


static func _on_node_exit(node: Node) -> void:
	if node != _node or not _is_initialized:
		return
	_node = null
	_clean_up()


## `release` processing after the core node: running requests end, then every static var takes its initial value.
static func _clean_up() -> void:
	_session = null
	_is_initialized = false
	_detach_camera()
	_node = null
	_min_zoom = 0.0
	_max_zoom = 0.0
	_shake_max_offset = 0.0
	_shake_max_rotation_deg = 0.0
	_shake_frequency_hz = 0.0
	_shake_decay_per_second = 0.0
	_max_duration_ms = 0
	_last_real_ms = 0
	_last_game_ms = 0
	_extent_min = Vector2.ZERO
	_extent_max = Vector2.ZERO
	_shake_scale = _FULL_SHAKE_SCALE
	_random = null
	_noise_elapsed_ms = 0
	_noise_step = 0
	_noise_from = Vector3.ZERO
	_noise_to = Vector3.ZERO


# Camera


## True while a camera is attached. Detaches a destroyed camera without a log.
static func _has_camera() -> bool:
	if _camera_id == 0:
		return false
	if not is_instance_id_valid(_camera_id):
		_detach_camera()
		return false
	return true


## True when the module is initialized and a camera is attached; otherwise logs `operation` and returns false.
static func _check_camera(operation: String) -> bool:
	if not _is_initialized:
		LogCore.log_error(_TAG, operation + ": not initialized")
		return false
	if not _has_camera():
		LogCore.log_error(_TAG, operation + ": no camera is attached")
		return false
	return true


static func _camera_inside_tree() -> bool:
	if _camera_2d != null:
		return _camera_2d.is_inside_tree()
	return _camera_3d != null and _camera_3d.is_inside_tree()


static func _detach_camera() -> void:
	var previous: _MOVE = _take_move()
	var previous_zoom: _MOVE = _take_zoom_move()
	_clear_camera()
	_cancel_moves(previous, previous_zoom)


## Puts the camera without the shake offset and clears the camera, follow, bounds and shake. The caller has taken the
## running moves out and ends them after its own changes.
static func _clear_camera() -> void:
	if _camera_id != 0 and is_instance_id_valid(_camera_id) and _camera_inside_tree():
		_shake_offset = Vector3.ZERO
		_shake_rotation = 0.0
		_apply_transform()
	_camera_id = 0
	_camera_2d = null
	_camera_3d = null
	_base = Vector3.ZERO
	_zoom = 1.0
	_zoom_one_2d = Vector2.ONE
	_rotation_2d = 0.0
	_fov_tan_one = 0.0
	_size_one = 0.0
	_bounds_error_logged = false
	_end_follow()
	_has_bounds = false
	_bounds = Rect2()
	_trauma = 0.0
	_shake_offset = Vector3.ZERO
	_shake_rotation = 0.0


## Ends the taken-out `previous` move and `previous_zoom` with `CANCELLED`.
static func _cancel_moves(previous: _MOVE, previous_zoom: _MOVE) -> void:
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)
	if previous_zoom != null:
		_finish(previous_zoom, CameraMoveResult.CANCELLED)


static func _end_follow() -> void:
	_follow_id = 0
	_follow_2d = null
	_follow_3d = null
	_follow_offset = Vector3.ZERO
	_follow_smooth_ms = 0
	_follow_dead_zone = Vector3.ZERO


## Half the size of the viewport of the 2D camera: the game coordinates of the screen center.
static func _half_view() -> Vector2:
	var viewport: Viewport = _camera_2d.get_viewport()
	if viewport == null:
		return Vector2.ZERO
	return viewport.get_visible_rect().size * 0.5


## Fits the reference position to the bounds, applies the zoom factor and puts the camera at the reference position
## plus the shake offset, now.
static func _apply_now() -> void:
	if not _camera_inside_tree():
		return
	_apply_zoom()
	_fit_bounds()
	_apply_transform()


static func _apply_zoom() -> void:
	if _camera_2d != null:
		_camera_2d.zoom = _zoom_one_2d * _zoom
	elif _camera_3d.projection == Camera3D.PROJECTION_PERSPECTIVE:
		_camera_3d.fov = rad_to_deg(2.0 * atan(_fov_tan_one / _zoom))
	else:
		_camera_3d.size = _size_one / _zoom


static func _apply_transform() -> void:
	if _camera_2d != null:
		_camera_2d.global_position = Vector2(_base.x + _shake_offset.x, _base.y + _shake_offset.y)
		_camera_2d.rotation = _rotation_2d + _shake_rotation
		_camera_2d.force_update_scroll()
	else:
		_camera_3d.global_position = _base + _shake_offset


## `value` with the axes the camera does not use at 0.
static func _on_axes(value: Vector3) -> Vector3:
	if _camera_2d != null:
		return Vector3(value.x, value.y, 0.0)
	return value


# Move and zoom


## True when `duration_ms`, `easing` and `time_basis` are usable; otherwise logs `operation` and returns false.
static func _check_timing(operation: String, duration_ms: int, easing: int, time_basis: int) -> bool:
	if duration_ms < 0 or duration_ms > _max_duration_ms:
		LogCore.log_error(_TAG, operation + ": the duration is below 0 or above TweenCore.maxDurationMs")
		return false
	if easing < 0 or easing >= TweenCore.Easing.size():
		LogCore.log_error(_TAG, operation + ": the easing is not an Easing member")
		return false
	if time_basis < 0 or time_basis >= TweenCore.TimeBasis.size():
		LogCore.log_error(_TAG, operation + ": the time basis is not a TimeBasis member")
		return false
	return true


static func _now(time_basis: TweenCore.TimeBasis) -> int:
	if time_basis == TweenCore.TimeBasis.GAME_TIME:
		return TimeCore.get_game_time()
	return TimeCore.get_real_time()


## Takes the running move out without ending it. The caller ends it after its own changes.
static func _take_move() -> _MOVE:
	var previous: _MOVE = _move
	_move = null
	return previous


## Takes the running zoom out without ending it. The caller ends it after its own changes.
static func _take_zoom_move() -> _MOVE:
	var previous: _MOVE = _zoom_move
	_zoom_move = null
	return previous


## A new running move. Follow ends and the previous move ends with `CANCELLED`.
static func _begin_move() -> _MOVE:
	var previous: _MOVE = _take_move()
	var move: _MOVE = _MOVE.new()
	_move = move
	_end_follow()
	if previous != null:
		_finish(previous, CameraMoveResult.CANCELLED)
	return move


## Starts `move` from the reference position. A duration of 0 applies `end` and completes now.
static func _start_move(
	move: _MOVE, end: Vector3, duration_ms: int, easing: TweenCore.Easing, time_basis: TweenCore.TimeBasis
) -> void:
	if move.done or _move != move:
		return
	move.easing = easing
	move.time_basis = time_basis
	move.duration_ms = duration_ms
	move.start_time = _now(time_basis)
	move.start_value = _base
	move.end_value = end
	if duration_ms > 0:
		return
	_base = end
	_apply_now()
	_finish(move, CameraMoveResult.COMPLETED)


## Async. Loads the tween preset of `move_by_preset` and starts or fails `move` with it.
static func _load_preset(move: _MOVE, end: Vector3, key: String, scope: Scope, session: RefCounted) -> void:
	var resource: Resource = await ResourceCore.load(key, TweenCore.get_preset_kind(), scope)
	if session != _session or move.done:
		return
	var change: TweenChange = _first_change(resource as TweenDefinition)
	if change == null:
		LogCore.log_error(_TAG, "move_by_preset: tween preset " + key + " did not load or has no first change")
		_finish(move, CameraMoveResult.FAILED)
		return
	if not _check_timing("move_by_preset", change.duration, change.easing, TweenCore.TimeBasis.GAME_TIME):
		_finish(move, CameraMoveResult.FAILED)
		return
	move.pending = false
	_start_move(move, end, change.duration, change.easing, TweenCore.TimeBasis.GAME_TIME)


static func _first_change(definition: TweenDefinition) -> TweenChange:
	if definition == null or definition.steps.is_empty():
		return null
	var first: TweenStep = definition.steps[0]
	if first == null or first.changes.is_empty():
		return null
	return first.changes[0]


## Async. The result of `move` once it ends. `FAILED` when the module was released meanwhile.
static func _wait(move: _MOVE) -> CameraMoveResult:
	var session: RefCounted = _session
	if not move.done:
		await move.finished
	if session != _session:
		return CameraMoveResult.FAILED
	return move.result


## Ends `move` with `result` once.
static func _finish(move: _MOVE, result: CameraMoveResult) -> void:
	if move.done:
		return
	move.done = true
	move.pending = false
	move.result = result
	if _move == move:
		_move = null
	if _zoom_move == move:
		_zoom_move = null
	move.finished.emit()


## Eased progress of `move` at `real_now` and `game_now`, and whether it reached the end.
static func _progress(move: _MOVE, real_now: int, game_now: int) -> float:
	var now: int = game_now if move.time_basis == TweenCore.TimeBasis.GAME_TIME else real_now
	var linear: float = clampf(float(now - move.start_time) / float(move.duration_ms), 0.0, 1.0)
	if linear >= 1.0:
		return 1.0
	return TweenCore.evaluate_easing(move.easing, linear)


static func _is_at_end(move: _MOVE, real_now: int, game_now: int) -> bool:
	var now: int = game_now if move.time_basis == TweenCore.TimeBasis.GAME_TIME else real_now
	return now - move.start_time >= move.duration_ms


# Frame processing


static func _on_frame() -> void:
	if not _is_initialized or not TimeCore.is_initialized():
		return
	var real_now: int = TimeCore.get_real_time()
	var game_now: int = TimeCore.get_game_time()
	var real_ms: int = real_now - _last_real_ms
	var game_ms: int = game_now - _last_game_ms
	_last_real_ms = real_now
	_last_game_ms = game_now
	if not _has_camera() or not _camera_inside_tree():
		return
	# 1. reference position
	var ended_move: _MOVE = null
	var ended_zoom: _MOVE = null
	var move: _MOVE = _move
	if move != null:
		if not move.pending:
			var ratio: float = _progress(move, real_now, game_now)
			_base = move.start_value + (move.end_value - move.start_value) * ratio
			if _is_at_end(move, real_now, game_now):
				_base = move.end_value
				ended_move = move
	elif _follow_id != 0:
		_advance_follow(game_ms)
	var zoom_move: _MOVE = _zoom_move
	if zoom_move != null:
		var zoom_ratio: float = _progress(zoom_move, real_now, game_now)
		_zoom = zoom_move.start_value.x + (zoom_move.end_value.x - zoom_move.start_value.x) * zoom_ratio
		if _is_at_end(zoom_move, real_now, game_now):
			_zoom = zoom_move.end_value.x
			ended_zoom = zoom_move
	_apply_zoom()
	# 2. bounds
	_fit_bounds()
	# 3. shake
	_advance_shake(real_ms)
	_apply_transform()
	if ended_move != null:
		_finish(ended_move, CameraMoveResult.COMPLETED)
	if ended_zoom != null:
		_finish(ended_zoom, CameraMoveResult.COMPLETED)


static func _advance_follow(game_ms: int) -> void:
	if not is_instance_id_valid(_follow_id):
		_end_follow()
		return
	if TimeCore.is_paused():
		return
	var target: Vector3 = Vector3.ZERO
	if _camera_3d != null:
		if not _follow_3d.is_inside_tree():
			return
		target = _follow_3d.global_position + _follow_offset
	else:
		if not _follow_2d.is_inside_tree():
			return
		var position_2d: Vector2 = _follow_2d.global_position
		target = Vector3(position_2d.x + _follow_offset.x, position_2d.y + _follow_offset.y, 0.0)
	var goal: Vector3 = _base
	var axes: int = 3 if _camera_3d != null else 2
	for axis: int in axes:
		var half: float = _follow_dead_zone[axis] * 0.5
		var distance: float = target[axis] - _base[axis]
		if half <= 0.0:
			goal[axis] = target[axis]
		elif distance > half:
			goal[axis] = target[axis] - half
		elif distance < -half:
			goal[axis] = target[axis] + half
	if _follow_smooth_ms == 0:
		_base = goal
	elif game_ms > 0:
		_base += (goal - _base) * (1.0 - exp(-float(game_ms) / float(_follow_smooth_ms)))


# Bounds


## Moves the reference position so the view range is inside the bounds. A view range longer than the bounds on an
## axis is centered on the bounds on that axis.
static func _fit_bounds() -> void:
	if not _has_bounds or not _view_extents():
		return
	var center: Vector2 = Vector2(_base.x, _base.z if _camera_3d != null else _base.y)
	for axis: int in 2:
		var low: float = _bounds.position[axis]
		var size: float = _bounds.size[axis]
		if _extent_max[axis] - _extent_min[axis] > size:
			center[axis] = low + size * 0.5 - (_extent_min[axis] + _extent_max[axis]) * 0.5
		elif center[axis] + _extent_min[axis] < low:
			center[axis] = low - _extent_min[axis]
		elif center[axis] + _extent_max[axis] > low + size:
			center[axis] = low + size - _extent_max[axis]
	_base.x = center.x
	if _camera_3d != null:
		_base.z = center.y
	else:
		_base.y = center.y


## Sets `_extent_min` and `_extent_max` to the view range of the reference position relative to it. False when a
## corner of a 3D camera does not meet the height 0 plane; the first time per camera logs an error.
static func _view_extents() -> bool:
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	var corner_a: Vector2 = area.position
	var corner_b: Vector2 = Vector2(area.end.x, area.position.y)
	var corner_c: Vector2 = Vector2(area.position.x, area.end.y)
	var corner_d: Vector2 = area.end
	if _camera_2d != null:
		var half: Vector2 = _half_view()
		var zoom: Vector2 = _camera_2d.zoom
		var angle: float = _camera_2d.global_rotation - _shake_rotation
		_extent_min = ((corner_a - half) / zoom).rotated(angle)
		_extent_max = _extent_min
		_add_extent(((corner_b - half) / zoom).rotated(angle))
		_add_extent(((corner_c - half) / zoom).rotated(angle))
		_add_extent(((corner_d - half) / zoom).rotated(angle))
		return true
	var first: Vector3 = _ground_offset(corner_a)
	var second: Vector3 = _ground_offset(corner_b)
	var third: Vector3 = _ground_offset(corner_c)
	var fourth: Vector3 = _ground_offset(corner_d)
	if first.y < 0.0 or second.y < 0.0 or third.y < 0.0 or fourth.y < 0.0:
		if not _bounds_error_logged:
			_bounds_error_logged = true
			LogCore.log_error(_TAG, "bounds fitting skipped: a view corner does not meet the height 0 plane")
		return false
	_extent_min = Vector2(first.x, first.z)
	_extent_max = _extent_min
	_add_extent(Vector2(second.x, second.z))
	_add_extent(Vector2(third.x, third.z))
	_add_extent(Vector2(fourth.x, fourth.z))
	return true


static func _add_extent(point: Vector2) -> void:
	_extent_min = _extent_min.min(point)
	_extent_max = _extent_max.max(point)


## Where the 3D camera ray through the game coordinates `screen` meets the height 0 plane, relative to the reference
## position, as x and z. y is -1 when it does not meet the plane, else 0.
static func _ground_offset(screen: Vector2) -> Vector3:
	var origin: Vector3 = _camera_3d.project_ray_origin(screen) - _camera_3d.global_position + _base
	var normal: Vector3 = _camera_3d.project_ray_normal(screen)
	var distance: float = _ray_to_ground(origin, normal)
	if distance < 0.0:
		return Vector3(0.0, -1.0, 0.0)
	var point: Vector3 = origin + normal * distance
	return Vector3(point.x - _base.x, 0.0, point.z - _base.z)


## Distance along the ray from `origin` in the direction `normal` to the height 0 plane. -1 when they do not meet.
static func _ray_to_ground(origin: Vector3, normal: Vector3) -> float:
	if absf(normal.y) < _PARALLEL_EPSILON:
		return -1.0
	var distance: float = -origin.y / normal.y
	if distance < 0.0:
		return -1.0
	return distance


# Shake


static func _advance_shake(real_ms: int) -> void:
	if _trauma > 0.0 and real_ms > 0:
		_trauma -= _shake_decay_per_second * float(real_ms) / 1000.0
		if _trauma < _TRAUMA_EPSILON:
			_trauma = 0.0
		_advance_noise(real_ms)
	var strength: float = _trauma * _trauma * float(_shake_scale) / float(_FULL_SHAKE_SCALE)
	if strength <= 0.0:
		_shake_offset = Vector3.ZERO
		_shake_rotation = 0.0
		return
	var position: float = float(_noise_elapsed_ms) * _shake_frequency_hz / 1000.0
	var noise: Vector3 = _noise_from.lerp(_noise_to, clampf(position - float(_noise_step), 0.0, 1.0))
	if _camera_3d != null:
		_shake_offset = noise * (_shake_max_offset * strength)
		_shake_rotation = 0.0
	else:
		_shake_offset = Vector3(noise.x, noise.y, 0.0) * (_shake_max_offset * strength)
		_shake_rotation = deg_to_rad(_shake_max_rotation_deg * strength * noise.z)


static func _advance_noise(real_ms: int) -> void:
	_noise_elapsed_ms += real_ms
	var step: int = floori(float(_noise_elapsed_ms) * _shake_frequency_hz / 1000.0)
	if step - _noise_step > _MAX_NOISE_DRAWS:
		_noise_step = step - _MAX_NOISE_DRAWS
	while _noise_step < step:
		_noise_step += 1
		_noise_from = _noise_to
		_noise_to = _draw_noise()


static func _draw_noise() -> Vector3:
	return Vector3(
		UtilCore.next_float(_random) * 2.0 - 1.0,
		UtilCore.next_float(_random) * 2.0 - 1.0,
		UtilCore.next_float(_random) * 2.0 - 1.0
	)


## New shake noise from `seed_value`: the noise time starts again.
static func _reseed(seed_value: int) -> void:
	_random = UtilCore.create_random(seed_value)
	_noise_elapsed_ms = 0
	_noise_step = 0
	_noise_from = _draw_noise()
	_noise_to = _draw_noise()


static func _is_finite_vector(value: Vector3) -> bool:
	return is_finite(value.x) and is_finite(value.y) and is_finite(value.z)
