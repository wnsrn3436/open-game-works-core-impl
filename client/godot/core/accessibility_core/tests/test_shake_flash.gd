extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## Reduce shake through `CameraCore.set_shake_scale`, reduce flash through `ScreenEffectCore.set_flash_opacity_limit`.

const SHAKE_SEED: int = 7
const SHAKE_FRAMES: int = 20
const FRAME_MS: int = 16
const OFFSET_EPSILON: float = 0.01
const OPACITY_EPSILON: float = 0.0001
const WORLD: ScreenEffectCore.ScreenEffectChannel = ScreenEffectCore.ScreenEffectChannel.WORLD


func before_each() -> void:
	super()
	set_float("CameraCore.shakeMaxRotationDeg", 0.0)
	set_int("TweenCore.maxDurationMs", 10000)


func test_reduce_shake_scales_the_shake_offset_of_every_frame_by_reduced_shake_permille() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var camera: Camera2D = Camera2D.new()
	add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	await UnitTestCore.wait_frames(1)
	var full: PackedVector2Array = await _shake_offsets(camera)
	AccessibilityCore.set_reduce_shake(true)
	var reduced: PackedVector2Array = await _shake_offsets(camera)
	AccessibilityCore.set_reduce_shake(false)
	var full_again: PackedVector2Array = await _shake_offsets(camera)
	var moved: bool = false
	for frame: int in SHAKE_FRAMES:
		var expected: Vector2 = full[frame] * REDUCED_SHAKE_PERMILLE / 1000.0
		assert_almost_eq(reduced[frame], expected, Vector2(OFFSET_EPSILON, OFFSET_EPSILON), "frame %d" % frame)
		assert_almost_eq(full_again[frame], full[frame], Vector2(OFFSET_EPSILON, OFFSET_EPSILON), "off, frame %d" % frame)
		moved = moved or full[frame].length() > 1.0
	assert_true(moved, "the shake moved the camera")


func test_reduce_flash_keeps_every_flash_frame_at_most_reduced_flash_max_opacity_and_off_reaches_1() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	AccessibilityCore.set_reduce_flash(true)
	var reduced: float = await _highest_flash_opacity(REDUCED_FLASH_MAX_OPACITY)
	assert_almost_eq(reduced, REDUCED_FLASH_MAX_OPACITY, OPACITY_EPSILON, "the reduced flash reaches its limit")
	AccessibilityCore.set_reduce_flash(false)
	var full: float = await _highest_flash_opacity(1.0)
	assert_almost_eq(full, 1.0, OPACITY_EPSILON, "the flash reaches opacity 1")


func test_saved_reduce_shake_and_reduce_flash_are_applied_by_apply_saved_settings() -> void:
	assert_true(await start_modules(false))
	var camera: Camera2D = Camera2D.new()
	add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	await UnitTestCore.wait_frames(1)
	var full: PackedVector2Array = await _shake_offsets(camera)
	LocalDataCore.set_value_bool(DEVICE, "AccessibilityCore.reduce_shake", true)
	LocalDataCore.set_value_bool(DEVICE, "AccessibilityCore.reduce_flash", true)
	assert_true(AccessibilityCore.init())
	AccessibilityCore.apply_saved_settings()
	var reduced: PackedVector2Array = await _shake_offsets(camera)
	var moved: bool = false
	for frame: int in SHAKE_FRAMES:
		var expected: Vector2 = full[frame] * REDUCED_SHAKE_PERMILLE / 1000.0
		assert_almost_eq(reduced[frame], expected, Vector2(OFFSET_EPSILON, OFFSET_EPSILON), "frame %d" % frame)
		moved = moved or full[frame].length() > 1.0
	assert_true(moved, "the shake moved the camera")
	var highest: float = await _highest_flash_opacity(REDUCED_FLASH_MAX_OPACITY)
	assert_almost_eq(highest, REDUCED_FLASH_MAX_OPACITY, OPACITY_EPSILON, "the reduced flash reaches its limit")


## The shake offset of each frame of `shake(1.0)` with `SHAKE_SEED`: the move of the canvas the camera shows from
## where it was without shake.
func _shake_offsets(camera: Camera2D) -> PackedVector2Array:
	CameraCore.stop_shake()
	await UnitTestCore.wait_frames(1)
	var rest: Vector2 = camera.get_viewport().get_canvas_transform().origin
	CameraCoreDev.set_shake_seed(SHAKE_SEED)
	CameraCore.shake(1.0)
	var offsets: PackedVector2Array = PackedVector2Array()
	for frame: int in SHAKE_FRAMES:
		await advance(FRAME_MS)
		offsets.append(rest - camera.get_viewport().get_canvas_transform().origin)
	CameraCore.stop_shake()
	return offsets


## The highest overlay opacity of a flash of maximum opacity 1 over its frames, each at most `limit`.
func _highest_flash_opacity(limit: float) -> float:
	var owner: Node = Node.new()
	add_child(owner)
	autofree(owner)
	ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	var highest: float = 0.0
	for frame: int in 40:
		await advance(10)
		var opacity: float = ScreenEffectCoreDev.get_overlay_state(WORLD).opacity
		assert_true(opacity <= limit + OPACITY_EPSILON, "flash opacity %s at frame %d" % [opacity, frame])
		highest = maxf(highest, opacity)
	return highest
