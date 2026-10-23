class_name CoreSettings
extends RefCounted
## Core settings reader. Not a module. Reads the core settings values and the game settings items core reads from
## `res://generated/core_settings.json`, a JSON object whose keys are core settings keys and game settings paths.
## A module reads the keys of its spec `## settings` in `init`, logs an error and fails `init` when `has_<type>`
## is false.

const SETTINGS_PATH: String = "res://generated/core_settings.json"

## Test values: the JSON text of a value by key. A key here wins over the file. Only `UnitTestCore`
## `set_test_settings`, `set_invalid_test_settings` and the test setup write it, through `_set_test_value` and
## `_clear_test_values`.
static var _test_values: Dictionary[String, String] = {}
## File values: the JSON text of each value of the settings file by key.
static var _file_values: Dictionary[String, String] = {}
static var _file_read: bool = false


## Whether `key` has a value of JSON type boolean.
# ogw:input_boundary
static func has_bool(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	return value is bool


## The boolean value of `key`. `false` when `has_bool` is false.
# ogw:input_boundary
static func get_bool(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if value is bool:
		return value
	return false


## Whether `key` has a value of JSON type integer.
# ogw:input_boundary
static func has_int(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if value is int:
		return true
	if value is float:
		var number: float = value
		return is_finite(number) and number == floorf(number)
	return false


## The integer value of `key`. 0 when `has_int` is false.
# ogw:input_boundary
static func get_int(key: String) -> int:
	if not has_int(key):
		return 0
	var value: Variant = JSON.parse_string(_text_of(key))
	if value is int:
		return value
	var number: float = value
	return int(number)


## Whether `key` has a value of JSON type number.
# ogw:input_boundary
static func has_float(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	return value is int or value is float


## The number value of `key`. 0 when `has_float` is false.
# ogw:input_boundary
static func get_float(key: String) -> float:
	var value: Variant = JSON.parse_string(_text_of(key))
	if value is int:
		var whole: int = value
		return float(whole)
	if value is float:
		return value
	return 0.0


## Whether `key` has a value of JSON type string.
# ogw:input_boundary
static func has_string(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	return value is String


## The string value of `key`. Empty when `has_string` is false.
# ogw:input_boundary
static func get_string(key: String) -> String:
	var value: Variant = JSON.parse_string(_text_of(key))
	if value is String:
		return value
	return ""


## Whether `key` has a JSON object value whose values are all strings.
# ogw:input_boundary
static func has_string_map(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if not value is Dictionary:
		return false
	var map: Dictionary = value
	for item: Variant in map.values():
		if not item is String:
			return false
	return true


## The JSON object value of `key` whose values are all strings, in the file's key order. Empty when
## `has_string_map` is false.
# ogw:input_boundary
static func get_string_map(key: String) -> Dictionary[String, String]:
	var result: Dictionary[String, String] = {}
	if not has_string_map(key):
		return result
	var value: Variant = JSON.parse_string(_text_of(key))
	var map: Dictionary = value
	for name: Variant in map.keys():
		var text: String = map[name]
		result[str(name)] = text
	return result


## Whether `key` has a JSON array value whose elements are all integers.
# ogw:input_boundary
static func has_int_array(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if not value is Array:
		return false
	var items: Array = value
	for item: Variant in items:
		if not _is_whole(item):
			return false
	return true


## The JSON array value of `key` whose elements are all integers. Empty when `has_int_array` is false.
# ogw:input_boundary
static func get_int_array(key: String) -> PackedInt64Array:
	var result: PackedInt64Array = PackedInt64Array()
	if not has_int_array(key):
		return result
	var value: Variant = JSON.parse_string(_text_of(key))
	var items: Array = value
	for item: Variant in items:
		var number: float = item
		result.append(int(number))
	return result


## Whether `key` has a JSON array value whose elements are all strings.
# ogw:input_boundary
static func has_string_array(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if not value is Array:
		return false
	var items: Array = value
	for item: Variant in items:
		if not item is String:
			return false
	return true


## The JSON array value of `key` whose elements are all strings. Empty when `has_string_array` is false.
# ogw:input_boundary
static func get_string_array(key: String) -> PackedStringArray:
	var result: PackedStringArray = PackedStringArray()
	if not has_string_array(key):
		return result
	var value: Variant = JSON.parse_string(_text_of(key))
	var items: Array = value
	for item: Variant in items:
		var text: String = item
		result.append(text)
	return result


## Whether `key` has a JSON object value whose values are all arrays of numbers.
# ogw:input_boundary
static func has_float_array_map(key: String) -> bool:
	var value: Variant = JSON.parse_string(_text_of(key))
	if not value is Dictionary:
		return false
	var map: Dictionary = value
	for item: Variant in map.values():
		if not item is Array:
			return false
		var items: Array = item
		for element: Variant in items:
			if not (element is int or element is float):
				return false
	return true


## The JSON object value of `key` whose values are all arrays of numbers, in the file's key order. Empty when
## `has_float_array_map` is false.
# ogw:input_boundary
static func get_float_array_map(key: String) -> Dictionary[String, PackedFloat64Array]:
	var result: Dictionary[String, PackedFloat64Array] = {}
	if not has_float_array_map(key):
		return result
	var value: Variant = JSON.parse_string(_text_of(key))
	var map: Dictionary = value
	for name: Variant in map.keys():
		var items: Array = map[name]
		var numbers: PackedFloat64Array = PackedFloat64Array()
		for element: Variant in items:
			var number: float = element
			numbers.append(number)
		result[str(name)] = numbers
	return result


## Whether a parsed JSON value is an integer. JSON numbers parse as `float`.
# ogw:input_boundary
static func _is_whole(value: Variant) -> bool:
	if value is int:
		return true
	if value is float:
		var number: float = value
		return is_finite(number) and number == floorf(number)
	return false


## Sets the test value of `key`. Only `UnitTestCore` uses it.
# ogw:input_boundary
static func _set_test_value(key: String, value: Variant) -> void:
	_test_values[key] = JSON.stringify(value)


## Clears the test values. Only `UnitTestCore` uses it.
static func _clear_test_values() -> void:
	_test_values.clear()


## Whether the file or a test value has `key`, whatever its type.
static func has_key(key: String) -> bool:
	_read_file()
	return _test_values.has(key) or _file_values.has(key)


## The JSON text of the value of `key`, the test value first: `null` when there is no value. For an object or array
## value the typed readers do not read; the module parses it in an input boundary function.
static func get_json(key: String) -> String:
	return _text_of(key)


## The JSON text of the value of `key`, the test value first. `null` when there is no value.
static func _text_of(key: String) -> String:
	if _test_values.has(key):
		return _test_values[key]
	_read_file()
	if _file_values.has(key):
		return _file_values[key]
	return "null"


# ogw:input_boundary
static func _read_file() -> void:
	if _file_read:
		return
	_file_read = true
	if not FileAccess.file_exists(SETTINGS_PATH):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SETTINGS_PATH))
	if not parsed is Dictionary:
		return
	var values: Dictionary = parsed
	for name: Variant in values.keys():
		_file_values[str(name)] = JSON.stringify(values[name])
