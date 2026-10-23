extends UnitTestCase
## Base of the CameraCore core tests: test settings, the modules CameraCore depends on started in module list order,
## cameras and targets freed after the test, move result recording, view range and shake offset reading.

const TAG: String = "CameraCore"
const ERROR: String = "error"
const MIN_ZOOM: float = 0.5
const MAX_ZOOM: float = 3.0
const SHAKE_MAX_OFFSET: float = 10.0
const SHAKE_MAX_ROTATION_DEG: float = 5.0
const SHAKE_FREQUENCY_HZ: float = 20.0
const SHAKE_DECAY_PER_SECOND: float = 2.0
const MAX_DURATION_MS: int = 10000
const SCREEN: Vector2i = Vector2i(1280, 720)
const SEED: int = 12345
const RESOURCES: String = "res://core/camera_core/tests/resources/"
## Tween preset: one change of 200 ms with `Linear`.
const MOVE: String = "tween/camera_test_move"
const MOVE_MS: int = 200
## Not in the test key list.
const MISSING: String = "tween/camera_test_missing"
const COMPLETED: CameraCore.CameraMoveResult = CameraCore.CameraMoveResult.COMPLETED
const CANCELLED: CameraCore.CameraMoveResult = CameraCore.CameraMoveResult.CANCELLED
const FAILED: CameraCore.CameraMoveResult = CameraCore.CameraMoveResult.FAILED
const LINEAR: TweenCore.Easing = TweenCore.Easing.LINEAR
const GAME: TweenCore.TimeBasis = TweenCore.TimeBasis.GAME_TIME

## Results of the moves started by `run_move`, `run_preset` and `run_zoom`, in the order they ended.
var results: Array[CameraCore.CameraMoveResult] = []
var shake_events: int = 0
var _nodes: Array[Node] = []


func before_each() -> void:
	super()
	results.clear()
	shake_events = 0
	assert_true(UnitTestCore.set_test_settings("CameraCore.minZoom", MIN_ZOOM))
	assert_true(UnitTestCore.set_test_settings("CameraCore.maxZoom", MAX_ZOOM))
	assert_true(UnitTestCore.set_test_settings("CameraCore.shakeMaxOffset", SHAKE_MAX_OFFSET))
	assert_true(UnitTestCore.set_test_settings("CameraCore.shakeMaxRotationDeg", SHAKE_MAX_ROTATION_DEG))
	assert_true(UnitTestCore.set_test_settings("CameraCore.shakeFrequencyHz", SHAKE_FREQUENCY_HZ))
	assert_true(UnitTestCore.set_test_settings("CameraCore.shakeDecayPerSecond", SHAKE_DECAY_PER_SECOND))
	assert_true(UnitTestCore.set_test_settings("TweenCore.maxDurationMs", MAX_DURATION_MS))
	assert_true(UnitTestCore.set_test_settings("TweenCore.maxRepeatCount", 5))
	assert_true(UnitTestCore.set_test_settings("InputBlockCore.maxDurationMs", 600000))


func after_each() -> void:
	super()
	CameraCore.release()
	TweenCore.release()
	ResolutionCore.release()
	InputBlockCore.release()
	PoolCore.release()
	ResourceCore.release()
	LocalDataCore.release()
	TimeCore.release()
	EventCore.release()
	LogCore.release()
	for node: Node in _nodes:
		if is_instance_valid(node):
			node.free()
	_nodes.clear()


## Starts the modules CameraCore depends on in module list order with a 1280x720 test screen, then CameraCore unless
## `init_camera_core` is false. Counts `CameraShakeStartedEvent` in `shake_events`.
func start(init_camera_core: bool = true) -> bool:
	var keys: Dictionary[String, String] = {MOVE: RESOURCES + "test_move.tres"}
	ResourceCoreDev.set_test_key_list(keys)
	var started: bool = (
		LogCore.init() and EventCore.init() and TimeCore.init() and LocalDataCore.init() and ResourceCore.init()
		and PoolCore.init() and InputBlockCore.init() and ResolutionCore.init() and TweenCore.init()
	)
	assert_true(started, "CameraCore dependencies init")
	if not started:
		return false
	ResolutionCoreDev.set_test_screen(SCREEN, SCREEN, ResolutionCore.FillMode.LETTERBOX, false)
	assert_true(EventCore.subscribe(CameraShakeStartedEvent, _on_shake_started))
	if not init_camera_core:
		return true
	var initialized: bool = CameraCore.init()
	assert_true(initialized, "CameraCore init")
	return initialized


## Adds `node` to the tree and frees it after the test. Returns it.
func keep(node: Node) -> Node:
	(Engine.get_main_loop() as SceneTree).root.add_child(node)
	_nodes.append(node)
	return node


func camera_2d(position: Vector2 = Vector2.ZERO) -> Camera2D:
	var camera: Camera2D = Camera2D.new()
	camera.position = position
	return keep(camera) as Camera2D


## A perspective camera at height 10 looking down by `pitch_deg` toward -Z.
func camera_3d(pitch_deg: float = -60.0, position: Vector3 = Vector3(0, 10, 10)) -> Camera3D:
	var camera: Camera3D = Camera3D.new()
	camera.position = position
	camera.rotation_degrees = Vector3(pitch_deg, 0, 0)
	return keep(camera) as Camera3D


func target_2d(position: Vector2 = Vector2.ZERO) -> Node2D:
	var target: Node2D = Node2D.new()
	target.position = position
	return keep(target) as Node2D


func target_3d(position: Vector3 = Vector3.ZERO) -> Node3D:
	var target: Node3D = Node3D.new()
	target.position = position
	return keep(target) as Node3D


func follow(target: Node, smooth_time_ms: int = 0, dead_zone: Vector3 = Vector3.ZERO,
		offset: Vector3 = Vector3.ZERO) -> bool:
	var options: FollowOptions = FollowOptions.new()
	options.smooth_time_ms = smooth_time_ms
	options.dead_zone = dead_zone
	options.offset = offset
	return CameraCore.follow(target, options)


## Moves the test clock and lets the core node run its frame processing after it.
func advance(ms: int) -> void:
	UnitTestCore.advance_clock(ms, false)
	await UnitTestCore.wait_frames(2)


## Waits until the core node ran its frame processing once after this call.
func frame_end() -> void:
	await UnitTestCore.wait_frames(1)


func errors() -> int:
	return UnitTestCore.check_logs(ERROR, TAG)


## Starts `move_to`; its result is appended to `results` when it ends.
func run_move(
	position: Vector3, duration_ms: int, easing: TweenCore.Easing = LINEAR, time_basis: TweenCore.TimeBasis = GAME
) -> void:
	var result: CameraCore.CameraMoveResult = await CameraCore.move_to(position, duration_ms, easing, time_basis)
	results.append(result)


## Starts `move_by_preset` with the `MOVE` preset in the global scope; its result is appended to `results`.
func run_preset(position: Vector3) -> void:
	var result: CameraCore.CameraMoveResult = await CameraCore.move_by_preset(
		position, MOVE, ResourceCore.get_global_scope()
	)
	results.append(result)


## Starts `zoom_to` with `Linear` on game time; its result is appended to `results`.
func run_zoom(zoom: float, duration_ms: int) -> void:
	var result: CameraCore.CameraMoveResult = await CameraCore.zoom_to(zoom, duration_ms, LINEAR, GAME)
	results.append(result)


## Async. Waits until the `MOVE` preset load that a `move_by_preset` started has ended.
func preset_loaded() -> void:
	await ResourceCore.load(MOVE, TweenCore.get_preset_kind(), ResourceCore.get_global_scope())


func assert_results(expected: Array[CameraCore.CameraMoveResult]) -> void:
	assert_eq(results.size(), expected.size(), "result count")
	for index: int in mini(results.size(), expected.size()):
		assert_eq(results[index], expected[index], "result %d" % index)


func assert_center(expected: Vector3, tolerance: float = 0.0001) -> void:
	var center: Vector3 = CameraCore.get_view_center()
	assert_almost_eq(center.x, expected.x, tolerance, "view center x")
	assert_almost_eq(center.y, expected.y, tolerance, "view center y")
	assert_almost_eq(center.z, expected.z, tolerance, "view center z")


## The visible game area corners in the order top left, top right, bottom left, bottom right.
func screen_corners() -> PackedVector2Array:
	var area: Rect2 = ResolutionCore.get_visible_game_area()
	return PackedVector2Array([
		area.position, Vector2(area.end.x, area.position.y), Vector2(area.position.x, area.end.y), area.end,
	])


## The view range read through `screen_to_world` of the visible game area corners: x, y for a 2D camera and x, z
## for a 3D camera.
func view_range() -> Rect2:
	var corners: PackedVector2Array = screen_corners()
	var range_rect: Rect2 = Rect2()
	for index: int in corners.size():
		var world: Vector3 = CameraCore.screen_to_world(corners[index])
		var point: Vector2 = Vector2(world.x, world.z) if CameraCore._camera_3d != null else Vector2(world.x, world.y)
		if index == 0:
			range_rect = Rect2(point, Vector2.ZERO)
		else:
			range_rect = range_rect.expand(point)
	return range_rect


## The shake offset now applied: the camera position minus the view center.
func shake_offset() -> Vector3:
	var center: Vector3 = CameraCore.get_view_center()
	if CameraCore._camera_3d != null:
		return CameraCore._camera_3d.global_position - center
	var position: Vector2 = CameraCore._camera_2d.global_position
	return Vector3(position.x - center.x, position.y - center.y, 0.0)


## Attaches a new 2D camera, seeds the shake noise with `SEED`, calls `shake(amount)` and returns the shake offset of
## each of `count` frames of 16 ms. Detaches the camera after.
func shake_offsets(count: int, amount: float = 1.0) -> PackedVector3Array:
	var offsets: PackedVector3Array = PackedVector3Array()
	assert_true(CameraCore.attach_camera(camera_2d()))
	CameraCoreDev.set_shake_seed(SEED)
	CameraCore.shake(amount)
	for frame: int in count:
		await advance(16)
		offsets.append(shake_offset())
	CameraCore.detach_camera()
	return offsets


func _on_shake_started(_event: CameraShakeStartedEvent) -> void:
	shake_events += 1
