extends UnitTestCase
## DEV operations: `set_test_level` and `set_test_device_info`.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")
const _RECORDER := preload("res://core/quality_core/tests/support/quality_test_recorder.gd")
const _LOW: QualityCore.QualityLevel = QualityCore.QualityLevel.LOW
const _MEDIUM: QualityCore.QualityLevel = QualityCore.QualityLevel.MEDIUM
const _HIGH: QualityCore.QualityLevel = QualityCore.QualityLevel.HIGH


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_set_test_level_applies_the_level_keeps_the_device_file_and_stops_the_auto_downgrade() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Medium")
	QualityCore.apply_saved_level()
	var recorder: _RECORDER = _RECORDER.new()
	assert_true(recorder.subscribe())
	QualityCoreDev.set_test_level(_HIGH)
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_eq(Engine.max_fps, _SUPPORT.HIGH_FPS)
	assert_almost_eq(_SUPPORT.render_scale(), 1.0, 0.0001)
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Medium")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "")
	assert_eq(recorder.levels.size(), 0)
	await _SUPPORT.run_frames(90, 25)
	assert_eq(QualityCore.get_level(), _HIGH, "no auto downgrade")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Medium")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "")


func test_auto_downgrade_comes_back_after_release_and_init() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCoreDev.set_test_level(_LOW)
	QualityCore.release()
	assert_true(QualityCore.init())
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, -1)
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_level(), _HIGH)
	await _SUPPORT.run_frames(45, 25)
	assert_eq(QualityCore.get_level(), _MEDIUM)


func test_set_test_level_outside_quality_level_is_ignored_with_an_error() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied())
	QualityCoreDev.set_test_level(3 as QualityCore.QualityLevel)
	assert_eq(_SUPPORT.errors(), 1)
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_false(QualityCore._test_level_active)


func test_set_test_device_info_with_invalid_values_is_ignored_with_an_error() -> void:
	# memory bytes, processor count, refresh rate
	var cases: Array[PackedInt64Array] = [
		PackedInt64Array([-2, 8, 60]),
		PackedInt64Array([8000, -2, 60]),
		PackedInt64Array([8000, 8, -2]),
		PackedInt64Array([8000, 0, 60]),
		PackedInt64Array([8000, 8, 0]),
	]
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	for item: PackedInt64Array in cases:
		QualityCoreDev.set_test_device_info(item[0], item[1], item[2])
		assert_eq(_SUPPORT.errors(), 1, str(item))
		assert_false(QualityCore._test_device_active, str(item))
	QualityCoreDev.set_test_device_info(0, 1, 1)
	assert_eq(_SUPPORT.errors(), 0, "memory 0, 1 processor and 1 Hz are valid")
	assert_true(QualityCore._test_device_active)


func test_set_test_device_info_is_cleared_by_release() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	QualityCoreDev.set_test_device_info(1, 1, 30)
	QualityCore.release()
	assert_true(QualityCore.init())
	assert_false(QualityCore._test_device_active)
	assert_eq(QualityCore._test_refresh_rate, -1)
