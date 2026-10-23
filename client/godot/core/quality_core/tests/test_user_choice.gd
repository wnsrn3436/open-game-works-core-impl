extends UnitTestCase
## `set_level`, `clear_override`, the saved override level across `release` and `init`, and `QualityChangedEvent`.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")
const _RECORDER := preload("res://core/quality_core/tests/support/quality_test_recorder.gd")
const _LOW: QualityCore.QualityLevel = QualityCore.QualityLevel.LOW
const _MEDIUM: QualityCore.QualityLevel = QualityCore.QualityLevel.MEDIUM
const _HIGH: QualityCore.QualityLevel = QualityCore.QualityLevel.HIGH


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_set_level_applies_saves_and_turns_the_override_state_on() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	assert_true(QualityCore.set_level(_LOW))
	assert_eq(QualityCore.get_level(), _LOW)
	assert_true(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "Low")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High", "the auto level stays")
	assert_eq(Engine.max_fps, _SUPPORT.LOW_FPS)


func test_set_level_then_release_init_and_apply_saved_level_gives_the_same_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	assert_true(QualityCore.set_level(_LOW))
	_SUPPORT.release_quality()
	assert_true(_SUPPORT.start_applied())
	assert_eq(QualityCore.get_level(), _LOW)
	assert_true(QualityCore.is_override())


func test_clear_override_applies_the_saved_auto_level_and_deletes_the_override_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	assert_true(QualityCore.set_level(_LOW))
	_SUPPORT.release_quality()
	assert_true(_SUPPORT.start_applied())
	QualityCore.clear_override()
	assert_eq(QualityCore.get_level(), _HIGH, "the saved auto level")
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "")
	assert_eq(Engine.max_fps, _SUPPORT.HIGH_FPS)
	_SUPPORT.release_quality()
	assert_true(_SUPPORT.start_applied())
	assert_eq(QualityCore.get_level(), _HIGH, "the override level stays deleted")
	assert_false(QualityCore.is_override())


func test_clear_override_without_a_saved_auto_level_applies_the_detection_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_OVERRIDE, "Low")
	QualityCoreDev.set_test_device_info(_SUPPORT.MEDIUM_MEMORY, _SUPPORT.MEDIUM_PROCESSORS, -1)
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_level(), _LOW)
	QualityCore.clear_override()
	assert_eq(QualityCore.get_level(), _MEDIUM)
	assert_false(QualityCore.is_override())


func test_clear_override_outside_the_override_state_does_nothing() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Low")
	QualityCore.clear_override()
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Low")
	assert_eq(recorder.levels.size(), 0)


func test_quality_changed_event_comes_once_only_when_the_level_changes() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	assert_true(QualityCore.set_level(_HIGH))
	assert_eq(recorder.levels.size(), 0, "set_level of the same level")
	assert_true(QualityCore.is_override(), "the same level still turns the override state on")
	assert_true(QualityCore.set_level(_MEDIUM))
	assert_eq(recorder.levels, PackedInt32Array([_MEDIUM]))
	assert_true(QualityCore.set_level(_MEDIUM))
	assert_eq(recorder.levels.size(), 1)
	QualityCore.clear_override()
	assert_eq(recorder.levels, PackedInt32Array([_MEDIUM, _HIGH]), "clear_override changed the level")
	assert_true(QualityCore.set_level(_HIGH))
	QualityCore.clear_override()
	assert_eq(recorder.levels.size(), 2, "clear_override to the same level")


func test_event_comes_after_the_profile_is_applied() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	assert_true(QualityCore.set_level(_LOW))
	assert_eq(recorder.levels, PackedInt32Array([_LOW]))
	assert_eq(recorder.max_fps, PackedInt32Array([_SUPPORT.LOW_FPS]), "the Low frame limit when the event comes")
	assert_almost_eq(recorder.render_scales[0], 0.5, 0.0001, "the Low render scale when the event comes")
	assert_eq(recorder.profile_render_scales, PackedInt32Array([_SUPPORT.LOW_RENDER_SCALE]))
	assert_eq(recorder.profile_frame_limits, PackedInt32Array([_SUPPORT.LOW_FPS]))
	QualityCore.clear_override()
	assert_eq(recorder.levels, PackedInt32Array([_LOW, _HIGH]))
	assert_eq(recorder.max_fps[1], _SUPPORT.HIGH_FPS, "the High frame limit when the clear_override event comes")
	assert_almost_eq(recorder.render_scales[1], 1.0, 0.0001, "the High render scale when the clear_override event comes")
	assert_eq(recorder.profile_render_scales[1], 1000)


func test_set_level_outside_quality_level_fails_with_an_error_and_keeps_the_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	assert_false(QualityCore.set_level(3 as QualityCore.QualityLevel))
	assert_false(QualityCore.set_level(-1 as QualityCore.QualityLevel))
	assert_eq(_SUPPORT.errors(), 2)
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "")
	assert_eq(recorder.levels.size(), 0)
