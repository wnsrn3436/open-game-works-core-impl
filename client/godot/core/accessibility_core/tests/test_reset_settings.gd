extends "res://core/accessibility_core/tests/support/accessibility_test_case.gd"
## `reset_settings`: every option back to its default, applied, the saved values removed, and one event when a value
## changed.

const KEYS: PackedStringArray = [
	"AccessibilityCore.text_scale",
	"AccessibilityCore.color_mode",
	"AccessibilityCore.subtitles",
	"AccessibilityCore.reduce_shake",
	"AccessibilityCore.reduce_flash",
]
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


func test_reset_settings_puts_every_option_back_to_the_default_applies_it_and_removes_the_saved_values() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	var camera: Camera2D = Camera2D.new()
	add_child(camera)
	autofree(camera)
	assert_true(CameraCore.attach_camera(camera))
	await UnitTestCore.wait_frames(1)
	var full: PackedVector2Array = await _shake_offsets(camera)
	assert_true(AccessibilityCore.set_text_scale(1250))
	assert_true(AccessibilityCore.set_color_mode(DEUTERANOPIA))
	AccessibilityCore.set_subtitles(false)
	AccessibilityCore.set_reduce_shake(true)
	AccessibilityCore.set_reduce_flash(true)
	for key: String in KEYS:
		assert_true(_saved(key), "saved before the reset: " + key)
	count_changes()
	AccessibilityCore.reset_settings()
	assert_eq(changes, 1, "one event for the reset")
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "after the reset")
	assert_eq(LocalizationCore.get_text_scale(), 1000)
	assert_false(AccessibilityCore._filter.visible, "the color filter is off")
	for key: String in KEYS:
		assert_false(_saved(key), "removed by the reset: " + key)
	var after: PackedVector2Array = await _shake_offsets(camera)
	var moved: bool = false
	for frame: int in SHAKE_FRAMES:
		assert_almost_eq(after[frame], full[frame], Vector2(OFFSET_EPSILON, OFFSET_EPSILON), "frame %d" % frame)
		moved = moved or full[frame].length() > 1.0
	assert_true(moved, "the shake moved the camera")
	var highest: float = await _highest_flash_opacity()
	assert_almost_eq(highest, 1.0, OPACITY_EPSILON, "the flash reaches opacity 1")
	AccessibilityCore.reset_settings()
	assert_eq(changes, 1, "a second reset publishes no event")
	AccessibilityCore.release()
	assert_true(AccessibilityCore.init())
	AccessibilityCore.apply_saved_settings()
	assert_settings(AccessibilityCore.get_settings(), 1000, NONE, true, false, false, "after release and init")
	assert_eq(errors(), 0)


func test_reset_settings_without_a_changed_value_publishes_no_event_and_removes_the_saved_values() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	assert_true(AccessibilityCore.set_text_scale(1250))
	assert_true(AccessibilityCore.set_text_scale(1000))
	assert_true(_saved("AccessibilityCore.text_scale"), "a saved default value")
	count_changes()
	AccessibilityCore.reset_settings()
	assert_eq(changes, 0)
	assert_false(_saved("AccessibilityCore.text_scale"), "the saved default value is removed")
	assert_eq(errors(), 0)


func test_reset_settings_hides_a_visible_subtitle_in_that_frame() -> void:
	set_bool("AccessibilityCore.subtitlesDefault", false)
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	await load_voice(VOICE_LOOP)
	AccessibilityCore.set_subtitles(true)
	var handle: int = AccessibilityCore.play_voice(VOICE_LOOP, scope, subtitle_key())
	assert_ne(handle, SoundCore.INVALID_HANDLE)
	assert_true(subtitle_visible())
	count_changes()
	AccessibilityCore.reset_settings()
	assert_false(subtitle_visible(), "hidden in the frame of the reset")
	assert_true(SoundCore.is_playing(handle), "the voice keeps playing")
	assert_false(AccessibilityCore.get_settings().subtitles)
	assert_eq(changes, 1)


func test_reset_settings_keeps_a_test_text_scale_unless_the_text_scale_option_value_changes() -> void:
	assert_true(await start_modules())
	AccessibilityCore.apply_saved_settings()
	AccessibilityCoreDev.set_test_text_scale(1500)
	AccessibilityCore.reset_settings()
	assert_eq(LocalizationCore.get_text_scale(), 1500, "the option value was already 1000")
	assert_true(AccessibilityCore.set_text_scale(1250))
	AccessibilityCoreDev.set_test_text_scale(1500)
	AccessibilityCore.reset_settings()
	assert_eq(LocalizationCore.get_text_scale(), 1000, "the option value changed from 1250")
	assert_eq(errors(), 0)


## Whether the `device` file holds `key` with the type of `## data`: a missing key gives each of two defaults back.
func _saved(key: String) -> bool:
	match key:
		"AccessibilityCore.text_scale":
			return LocalDataCore.get_value_int(DEVICE, key, -1) != -1 or LocalDataCore.get_value_int(DEVICE, key, -2) != -2
		"AccessibilityCore.color_mode":
			return LocalDataCore.get_value_string(DEVICE, key, "") != "" or LocalDataCore.get_value_string(DEVICE, key, "-") != "-"
	return LocalDataCore.get_value_bool(DEVICE, key, false) != LocalDataCore.get_value_bool(DEVICE, key, true)


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


## The highest overlay opacity over the frames of a flash of maximum opacity 1.
func _highest_flash_opacity() -> float:
	var owner: Node = Node.new()
	add_child(owner)
	autofree(owner)
	ScreenEffectCore.flash(WORLD, owner, Color.WHITE, 1.0, 100, 100, 100)
	var highest: float = 0.0
	for frame: int in 40:
		await advance(10)
		highest = maxf(highest, ScreenEffectCoreDev.get_overlay_state(WORLD).opacity)
	return highest
