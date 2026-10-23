extends UnitTestCase
## `init` fails with an error log for each invalid `QualityCore.levels` and `QualityCore.deviceClasses` value of the
## error table, and for a missing or mistyped setting.

const _SUPPORT := preload("res://core/quality_core/tests/support/quality_test_support.gd")


func after_each() -> void:
	super()
	_SUPPORT.stop()


func test_invalid_levels_values_fail_init_with_an_error() -> void:
	var good: String = _SUPPORT.level_json(1000, "High", 1000, 1000)
	var cases: PackedStringArray = [
		'{"Medium": %s, "High": %s}' % [good, good],
		'{"Low": %s, "High": %s}' % [good, good],
		'{"Low": %s, "Medium": %s}' % [good, good],
		'{"Low": 1, "Medium": %s, "High": %s}' % [good, good],
		_with_low(_SUPPORT.level_json(1000, "Ultra", 1000, 1000)),
		_with_low(_SUPPORT.level_json(1000, "off", 1000, 1000)),
		_with_low(_SUPPORT.level_json(0, "Off", 1000, 1000)),
		_with_low(_SUPPORT.level_json(1001, "Off", 1000, 1000)),
		_with_low(_SUPPORT.level_json(1000, "Off", 1000, 0)),
		_with_low(_SUPPORT.level_json(1000, "Off", 1000, 1001)),
		_with_low(_SUPPORT.level_json(1000, "Off", -1, 1000)),
		_with_low(_SUPPORT.level_json(1000, "Off", 1001, 1000)),
		_with_low('{"renderScalePermille": 1000, "shadow": "Off", "effectDensityPermille": 1000}'),
		_with_low('{"renderScalePermille": 1000, "effectDensityPermille": 1000, "frameLimitPermille": 1000}'),
		_with_low('{"renderScalePermille": 500.5, "shadow": "Off", "effectDensityPermille": 1000, "frameLimitPermille": 1000}'),
		_with_low('{"renderScalePermille": "500", "shadow": "Off", "effectDensityPermille": 1000, "frameLimitPermille": 1000}'),
	]
	for levels: String in cases:
		_SUPPORT.set_common_settings()
		_SUPPORT.set_invalid_json("QualityCore.levels", levels)
		_expect_init_failure(levels)


func test_edge_levels_values_pass_init() -> void:
	_SUPPORT.set_common_settings()
	_SUPPORT.set_json("QualityCore.levels", _with_low(_SUPPORT.level_json(1, "Off", 0, 1)))
	assert_true(_SUPPORT.start())


func test_invalid_device_classes_values_fail_init_with_an_error() -> void:
	var cases: PackedStringArray = [
		'[{"level": "Low", "minMemoryBytes": 0, "minProcessorCount": 0}]',
		'[{"level": "Ultra", "minMemoryBytes": 0, "minProcessorCount": 0}]',
		'[{"level": "high", "minMemoryBytes": 0, "minProcessorCount": 0}]',
		'[{"minMemoryBytes": 0, "minProcessorCount": 0}]',
		'[{"level": "High", "minProcessorCount": 0}]',
		'[{"level": "High", "minMemoryBytes": 0}]',
		'[{"level": "High", "minMemoryBytes": -1, "minProcessorCount": 0}]',
		'[{"level": "High", "minMemoryBytes": 0, "minProcessorCount": -1}]',
		'[{"level": "High", "minMemoryBytes": 0.5, "minProcessorCount": 0}]',
		'[{"level": "Medium", "minMemoryBytes": 0, "minProcessorCount": 0}, 1]',
	]
	for device_classes: String in cases:
		_SUPPORT.set_common_settings()
		_SUPPORT.set_invalid_json("QualityCore.deviceClasses", device_classes)
		_expect_init_failure(device_classes)


func test_low_level_item_missing_processor_count_and_negative_memory_fail_init() -> void:
	var cases: PackedStringArray = [
		'[{"level": "Low", "minMemoryBytes": 0, "minProcessorCount": 0}]',
		'[{"level": "High", "minMemoryBytes": 4000}]',
		'[{"level": "Medium", "minMemoryBytes": -4000, "minProcessorCount": 2}]',
	]
	for device_classes: String in cases:
		_SUPPORT.set_common_settings()
		_SUPPORT.set_json("QualityCore.deviceClasses", device_classes)
		_expect_init_failure(device_classes)


func test_out_of_range_integer_settings_fail_init_with_an_error() -> void:
	var cases: Dictionary[String, int] = {
		"QualityCore.autoDowngradeWindowMs": -1,
		"QualityCore.autoDowngradeFpsPermille": 1001,
		"QualityCore.hitchFrameMs": -1,
	}
	for key: String in cases:
		_SUPPORT.set_common_settings()
		UnitTestCore.set_test_settings(key, cases[key])
		_expect_init_failure(key)


## `QualityCore.init` fails with one error log, puts nothing in the tree, and keeps the module uninitialized.
func _expect_init_failure(label: String) -> void:
	assert_true(_SUPPORT.start_dependencies(), label)
	assert_false(QualityCore.init(), label)
	assert_eq(_SUPPORT.errors(), 1, label)
	assert_false(QualityCore.is_initialized(), label)
	assert_null(QualityCore._node, label)
	assert_true(QualityCore._profiles.is_empty(), label)
	_SUPPORT.release_quality()


## JSON text of a `QualityCore.levels` value with `low` as the `Low` item and valid `Medium` and `High` items.
func _with_low(low: String) -> String:
	var good: String = _SUPPORT.level_json(1000, "High", 1000, 1000)
	return '{"Low": %s, "Medium": %s, "High": %s}' % [low, good, good]
