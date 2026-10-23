extends UnitTestCase
## `apply_saved_level`: the device class detection level and its save, the saved override level before the saved auto
## level, and saved values that are no `QualityLevel` element name.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")
const _LOW: QualityCore.QualityLevel = QualityCore.QualityLevel.LOW
const _MEDIUM: QualityCore.QualityLevel = QualityCore.QualityLevel.MEDIUM
const _HIGH: QualityCore.QualityLevel = QualityCore.QualityLevel.HIGH
const _NAMES: PackedStringArray = ["Low", "Medium", "High"]


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_without_saved_values_the_detection_level_is_applied_and_saved_as_the_auto_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start_applied(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS))
	assert_eq(QualityCore.get_level(), _HIGH)
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_OVERRIDE), "")
	assert_eq(Engine.max_fps, _SUPPORT.HIGH_FPS, "the detection level is applied")


func test_detection_level_is_the_level_of_the_first_matching_device_class_item_and_low_without_one() -> void:
	# memory bytes, processor count, expected level. -1 is a value the engine could not read.
	var cases: Array[PackedInt64Array] = [
		PackedInt64Array([8000, 8, _HIGH]),
		PackedInt64Array([100000, 64, _HIGH]),
		PackedInt64Array([7999, 8, _MEDIUM]),
		PackedInt64Array([8000, 7, _MEDIUM]),
		PackedInt64Array([4000, 4, _MEDIUM]),
		PackedInt64Array([3999, 64, _LOW]),
		PackedInt64Array([100000, 3, _LOW]),
		PackedInt64Array([-1, 8, _HIGH]),
		PackedInt64Array([-1, 4, _MEDIUM]),
		PackedInt64Array([-1, 2, _LOW]),
		PackedInt64Array([5000, -1, _MEDIUM]),
		PackedInt64Array([-1, -1, _HIGH]),
	]
	_SUPPORT.set_common_settings()
	for item: PackedInt64Array in cases:
		var label: String = "memory %d, processors %d" % [item[0], item[1]]
		assert_true(_SUPPORT.start())
		QualityCoreDev.set_test_device_info(item[0], item[1], -1)
		QualityCore.apply_saved_level()
		assert_eq(QualityCore.get_level(), item[2] as QualityCore.QualityLevel, label)
		assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), _NAMES[item[2]], label)
		LocalDataCore.remove_value(_SUPPORT.DEVICE, _SUPPORT.KEY_AUTO)
		_SUPPORT.release_quality()


func test_detection_looks_at_the_high_items_before_the_medium_items() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json(
		"QualityCore.deviceClasses",
		'[{"level": "Medium", "minMemoryBytes": 0, "minProcessorCount": 0},'
		+ ' {"level": "High", "minMemoryBytes": 0, "minProcessorCount": 0}]'
	)
	assert_true(_SUPPORT.start_applied(1, 1))
	assert_eq(QualityCore.get_level(), _HIGH)


func test_detection_without_device_class_items_is_low() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json("QualityCore.deviceClasses", "[]")
	assert_true(_SUPPORT.start_applied())
	assert_eq(QualityCore.get_level(), _LOW)
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Low")


func test_saved_auto_level_is_used_without_detection() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Low")
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, -1)
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_level(), _LOW)
	assert_false(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "Low")


func test_saved_override_level_comes_before_the_saved_auto_level() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "High")
	_SUPPORT.save(_SUPPORT.KEY_OVERRIDE, "Low")
	QualityCore.apply_saved_level()
	assert_eq(QualityCore.get_level(), _LOW)
	assert_true(QualityCore.is_override())
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High", "the auto level stays")


func test_saved_values_that_are_no_level_element_name_log_a_warning_and_go_to_the_next_step() -> void:
	_SUPPORT.set_common_settings()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_OVERRIDE, "Ultra")
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "Low")
	QualityCore.apply_saved_level()
	assert_eq(_SUPPORT.warnings(), 1)
	assert_eq(QualityCore.get_level(), _LOW, "the saved auto level")
	assert_false(QualityCore.is_override())
	_SUPPORT.release_quality()
	assert_true(_SUPPORT.start())
	_SUPPORT.save(_SUPPORT.KEY_OVERRIDE, "high")
	_SUPPORT.save(_SUPPORT.KEY_AUTO, "MEDIUM")
	QualityCoreDev.set_test_device_info(_SUPPORT.HIGH_MEMORY, _SUPPORT.HIGH_PROCESSORS, -1)
	QualityCore.apply_saved_level()
	assert_eq(_SUPPORT.warnings(), 2, "element names are case sensitive")
	assert_eq(QualityCore.get_level(), _HIGH, "the detection level")
	assert_eq(_SUPPORT.saved(_SUPPORT.KEY_AUTO), "High", "the detection level is saved")


func test_level_before_apply_saved_level_is_medium_and_not_applied() -> void:
	_SUPPORT.set_common_settings()
	var max_fps: int = Engine.max_fps
	var render_scale: float = _SUPPORT.render_scale()
	assert_true(_SUPPORT.start())
	assert_eq(QualityCore.get_level(), _MEDIUM)
	assert_eq(QualityCore.get_profile().render_scale_permille, _SUPPORT.MEDIUM_RENDER_SCALE)
	assert_eq(Engine.max_fps, max_fps)
	assert_almost_eq(_SUPPORT.render_scale(), render_scale, 0.0001)
