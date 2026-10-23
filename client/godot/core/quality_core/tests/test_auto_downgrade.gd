extends UnitTestCase
## Auto downgrade: the measurement window, the base FPS with the refresh rate, the dropped hitch frames, the background
## frames and return, and the states that do not measure. Common settings: window 1000 ms, 800 permille, hitch frames
## over 100 ms; frame limit 60 at `High` and `Medium`, so the threshold is 48 FPS without a lower refresh rate.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")
const _RECORDER := preload("res://core/quality_core/tests/support/quality_test_recorder.gd")
const _LOW: QualityCore.QualityLevel = QualityCore.QualityLevel.LOW
const _MEDIUM: QualityCore.QualityLevel = QualityCore.QualityLevel.MEDIUM
const _HIGH: QualityCore.QualityLevel = QualityCore.QualityLevel.HIGH
## 40 FPS frames: below the threshold. 45 of them end one window and not the next.
const _SLOW_MS: int = 25
const _SLOW_FRAMES: int = 45
## 50 FPS frames: at or above the threshold. 55 of them end one window and not the next.
const _FAST_MS: int = 20
const _FAST_FRAMES: int = 55


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_window_below_the_threshold_lowers_the_level_by_one_and_saves_it() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Medium")
	assert_false(QualityCore.is_override())
	assert_eq(recorder.levels, PackedInt32Array([_MEDIUM]))
	assert_eq(Engine.max_fps, _SUPPORT.MEDIUM_FPS)
	assert_almost_eq(recorder.render_scales[0], 0.8, 0.0001, "the Medium render scale when the event comes")
	assert_eq(recorder.profile_render_scales, PackedInt32Array([_SUPPORT.MEDIUM_RENDER_SCALE]))
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _LOW, "the next window lowers again")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Low")
	assert_eq(recorder.levels, PackedInt32Array([_MEDIUM, _LOW]))


func test_window_at_or_above_the_threshold_keeps_the_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	await _SUPPORT.run_frames(_FAST_FRAMES * 2, _FAST_MS)
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High")


func test_level_does_not_go_below_low() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Low")
	QualityCore.apply_saved_level()
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _LOW)
	assert_eq(recorder.levels.size(), 0)


func test_override_state_does_not_lower_the_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	assert_true(QualityCore.set_level(_HIGH))
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High")


func test_disabled_auto_downgrade_does_not_lower_the_level() -> void:
	_SUPPORT.set_common_settings()
	UnitTestCore.set_test_settings("QualityCore.autoDowngradeEnabled", false)
	assert_true(_SUPPORT.start_applied())
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _HIGH)


func test_no_measurement_before_apply_saved_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "")


func test_hitch_frames_are_not_in_the_average() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	await _run_fast_frames_with_hitches(11)
	assert_eq(QualityCore.get_level(), _HIGH)


func test_hitch_frames_within_the_hitch_limit_are_in_the_average() -> void:
	_SUPPORT.set_common_settings()
	UnitTestCore.set_test_settings("QualityCore.hitchFrameMs", 500)
	assert_true(_SUPPORT.start_applied())
	await _run_fast_frames_with_hitches(3)
	assert_eq(QualityCore.get_level(), _MEDIUM, "the same frames lower the level when the 500 ms frames count")


func test_refresh_rate_below_the_frame_limit_is_the_base_fps() -> void:
	_set_frame_limit_120()
	assert_true(_SUPPORT.start())
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, 60)
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_profile().frame_limit_fps, 120)
	await _SUPPORT.run_frames(_FAST_FRAMES, _FAST_MS)
	assert_eq(QualityCore.get_level(), _HIGH, "50 FPS is not below 60 × 800 ÷ 1000")


func test_unread_refresh_rate_judges_with_the_frame_limit() -> void:
	_set_frame_limit_120()
	assert_true(_SUPPORT.start())
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, -1)
	QualityCore.apply_saved_level()
	await _SUPPORT.run_frames(_FAST_FRAMES, _FAST_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM, "50 FPS is below 120 × 800 ÷ 1000")


func test_refresh_rate_above_the_frame_limit_keeps_the_frame_limit() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, 144)
	QualityCore.apply_saved_level()
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM, "40 FPS is below 60 × 800 ÷ 1000")


func test_background_return_clears_the_measurement() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	await _SUPPORT.run_frames(30, _SLOW_MS)
	UnitTestCore.advance_clock(5000, true)
	await _SUPPORT.run_frames(30, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _HIGH, "750 ms after the return does not reach the window")
	await _SUPPORT.run_frames(15, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM)


func test_background_frames_are_not_measured() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	await _SUPPORT.run_frames(30, _SLOW_MS)
	var frames: int = QualityCore._measured_frames
	var measured_ms: int = QualityCore._measured_ms
	assert_true(frames > 0)
	assert_true(measured_ms > 0 and measured_ms < _SUPPORT.WINDOW_MS)
	_publish(AppBackgroundEnteredEvent)
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	await _SUPPORT.run_frames(200, 1)
	assert_eq(QualityCore._measured_frames, frames, "background frames are not counted")
	assert_eq(QualityCore._measured_ms, measured_ms, "background frame time is not counted")
	assert_eq(QualityCore.get_level(), _HIGH, "the background frames do not end the window")
	_publish(AppForegroundReturnedEvent)
	assert_eq(QualityCore._measured_frames, 0, "the return clears the measurement")
	await _SUPPORT.run_frames(_SLOW_FRAMES, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _MEDIUM, "frames after the return are measured")


func test_override_state_on_and_off_clears_the_measurement() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	await _SUPPORT.run_frames(30, _SLOW_MS)
	assert_true(QualityCore._measured_frames > 0)
	assert_true(QualityCore.set_level(_HIGH))
	QualityCore.clear_override()
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_eq(QualityCore._measured_frames, 0)
	assert_eq(QualityCore._measured_ms, 0)
	await _SUPPORT.run_frames(30, _SLOW_MS)
	assert_eq(QualityCore.get_level(), _HIGH, "750 ms after clear_override does not reach the window")


## Publishes the TimeCore app state event `type` as the engine background entry or return does.
func _publish(type: GDScript) -> void:
	var event: EventBase = EventCore.acquire(type)
	assert_not_null(event)
	EventCore.publish(event)


func _set_frame_limit_120() -> void:
	_SUPPORT.set_common_settings()
	UnitTestCore.set_test_settings("targetFps", 120)


## `blocks` times 5 frames of 20 ms and a 400 ms frame: 50 FPS without the 400 ms frames, about 15 FPS with them.
## 11 blocks end one window of the 20 ms frames; 3 blocks end one window when the 400 ms frames count.
func _run_fast_frames_with_hitches(blocks: int) -> void:
	for i: int in blocks:
		await _SUPPORT.run_frames(5, _FAST_MS)
		await _SUPPORT.run_frames(1, 400)
