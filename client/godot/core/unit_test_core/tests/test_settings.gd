extends "res://core/unit_test_core/tests/support/unit_test_core_test_case.gd"
## The type check of `set_test_settings`: the value against the key's spec `## settings` type in the core settings type
## file, not against the settings file value. The refusals that fail a test are in the nested run of
## `sample_settings.gd` (`test_run.gd`).

const TYPES_PATH: String = "res://generated/core_settings_types.json"
## A `number` key whose settings file value is whole (review R2-1), and an `object` key whose settings file member
## values are all whole (review R3-1).
const WHOLE_NUMBER_KEY: String = "UICore.keyboardGap"
const WHOLE_MEMBERS_KEY: String = "SoundCore.busLoudnessLufs"


func test_init_reads_the_core_settings_type_file() -> void:
	var file_types: Dictionary[String, String] = _file_types()
	assert_false(file_types.is_empty(), "the core settings type file has keys")
	assert_eq(UnitTestCore._settings_types, file_types)
	assert_eq(str(UnitTestCore._settings_types.get(WHOLE_NUMBER_KEY, "")), "number")
	assert_eq(str(UnitTestCore._settings_types.get(WHOLE_MEMBERS_KEY, "")), "object")


## Review R2-1: the settings file value `16` of the `number` key does not make it an integer key.
func test_fraction_for_a_number_key_whose_settings_file_value_is_whole() -> void:
	assert_true(CoreSettings.has_int(WHOLE_NUMBER_KEY), "the settings file value is whole")
	assert_true(UnitTestCore.set_test_settings(WHOLE_NUMBER_KEY, 16.5))
	assert_eq(CoreSettings.get_float(WHOLE_NUMBER_KEY), 16.5)


## Review R3-1: the all-integer member values of the settings file value of the `object` key do not make its members
## integers.
func test_fraction_member_for_an_object_key_whose_settings_file_members_are_whole() -> void:
	assert_true(_file_members_are_whole(WHOLE_MEMBERS_KEY), "the settings file value is an object of whole numbers")
	var value: Dictionary[String, float] = {"Bgm": -23.5, "Sfx": -18.0, "Voice": -16.0, "Ui": -20.0}
	assert_true(UnitTestCore.set_test_settings(WHOLE_MEMBERS_KEY, value))
	assert_eq(CoreSettings.get_json(WHOLE_MEMBERS_KEY), JSON.stringify(value))


## Each type string of the core settings type file is a settings type with a case in `_check_type_cases`, and
## `set_test_settings` takes the values of the case for a key of that type.
func test_each_type_of_the_type_file_takes_its_values() -> void:
	var keys: Dictionary[String, String] = {}
	for key: String in UnitTestCore._settings_types:
		var settings_type: String = UnitTestCore._settings_types[key]
		if not keys.has(settings_type):
			keys[settings_type] = key
	assert_true(keys.size() >= 12, "type strings of the type file")
	var cases: PackedStringArray = _check_type_cases(keys)
	for settings_type: String in keys:
		assert_true(UnitTestCore._is_settings_type(settings_type), "%s of %s is a settings type" % [settings_type, keys[settings_type]])
		assert_true(settings_type in cases, "a case of %s" % settings_type)


func test_each_type_string_takes_values_of_the_type_only() -> void:
	var cases: PackedStringArray = _check_type_cases({})
	assert_eq(cases.size(), 20)


func test_type_strings_that_are_no_settings_type() -> void:
	for settings_type: String in ["", "int", "float", "bool", "null", "?", "integer??", "array", "array<>", "array<integer",
			"array<int>", "object<string>", "Array<integer>", " integer", "array<integer>>"]:
		assert_false(UnitTestCore._is_settings_type(settings_type), "'%s'" % settings_type)


## Checks the values of each spec settings type string: the type is a settings type, takes its values and refuses the
## values of another type. The types of the core settings type file are among them, and also those the core spec does
## not use yet. For a type that is a key of `keys`, `set_test_settings` takes each value for the key `keys[type]` and
## `CoreSettings` reads it. Returns the type strings.
# ogw:input_boundary
func _check_type_cases(keys: Dictionary[String, String]) -> PackedStringArray:
	var cases: Array = [
		["integer", [0, -7, 9007199254740993, 16.0], [16.5, "1", true, null, [1], {}, NAN, INF]],
		["integer?", [null, 7, 7.0], [7.5, "7", false, []]],
		["number", [16, 16.5, -23.5, 0.0], ["16.5", true, null, [16.5], NAN, INF, -INF]],
		["number?", [null, 1, 0.25], ["0.25", false, NAN]],
		["string", ["", "text"], [1, true, null, ["text"], {}]],
		["string?", [null, "", "text"], [1, false, ["text"]]],
		["boolean", [true, false], [0, 1, "true", null]],
		["boolean?", [null, true], [0, "false"]],
		["object", [{}, {"Bgm": -23.5}, {"a": "x", "b": [1, "y"], "c": null}], [[], "{}", 1, null]],
		["object?", [null, {}, {"a": 1}], [[], "x", 0]],
		["array<integer>", [[], [1, 2], [16.0], PackedInt64Array([4, 5]), PackedInt32Array([1])],
			[[1.5], [1, "2"], [null], {}, "[]", null, PackedFloat64Array([0.5])]],
		["array<integer>?", [null, [1]], [[0.5], "x"]],
		["array<number>", [[], [1, 2.5], PackedFloat64Array([0.5]), PackedInt64Array([3])], [[1, "2"], [null], [NAN], null]],
		["array<string>", [[], ["en", "ca"], PackedStringArray(["en"])], [[1], ["en", null], "en", null, {}]],
		["array<string>?", [null, [], ["10.0.0.0/8"]], [[1], "10.0.0.0/8"]],
		["array<boolean>", [[], [true, false]], [[0], ["true"], null]],
		["array<object>", [[], [{"level": "High"}, {}]], [[{"level": "High"}, 5], [[]], [null], {}, null]],
		["array<object>?", [null, [{}]], [[1], {}]],
		["array<array<integer>>", [[], [[1, 2], []], [PackedInt64Array([1])]], [[1, 2], [[0.5]], [null]]],
		["array<integer?>", [[], [1, null]], [[0.5], null]],
	]
	var types: PackedStringArray = PackedStringArray()
	for item: Array in cases:
		var settings_type: String = item[0]
		var accepted: Array = item[1]
		var refused: Array = item[2]
		types.append(settings_type)
		assert_true(UnitTestCore._is_settings_type(settings_type), settings_type)
		for value: Variant in accepted:
			assert_true(UnitTestCore._has_settings_type(value, settings_type), "%s takes %s" % [settings_type, str(value)])
		for value: Variant in refused:
			assert_false(UnitTestCore._has_settings_type(value, settings_type), "%s refuses %s" % [settings_type, str(value)])
		if not keys.has(settings_type):
			continue
		var key: String = keys[settings_type]
		for value: Variant in accepted:
			assert_true(UnitTestCore.set_test_settings(key, value), "%s %s takes %s" % [settings_type, key, str(value)])
			assert_eq(CoreSettings.get_json(key), JSON.stringify(value), "%s %s reads %s" % [settings_type, key, str(value)])
	return types


## Whether the settings file value of `key` is an object whose member values are all whole numbers.
# ogw:input_boundary
static func _file_members_are_whole(key: String) -> bool:
	var text: String = CoreSettings._file_values.get(key, "null")
	var parsed: Variant = JSON.parse_string(text)
	if not parsed is Dictionary:
		return false
	var members: Dictionary = parsed
	for member: Variant in members.values():
		if not UnitTestCore._is_whole(member):
			return false
	return true


## The core settings type file: the type string by key. Empty when it cannot be read.
# ogw:input_boundary
static func _file_types() -> Dictionary[String, String]:
	var types: Dictionary[String, String] = {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(TYPES_PATH))
	if not parsed is Dictionary:
		return types
	var members: Dictionary = parsed
	for key: Variant in members.keys():
		types[str(key)] = str(members[key])
	return types
