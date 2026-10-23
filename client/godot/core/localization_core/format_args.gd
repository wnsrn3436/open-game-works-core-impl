class_name FormatArgs
extends RefCounted
## Format argument values by name for `LocalizationCore.format`. A value is a 64-bit integer, a 64-bit real or a
## string. Setting a name again replaces its value. A caller makes one object and `clear`s it to use it again.

const _KIND_INT: int = 1
const _KIND_FLOAT: int = 2
const _KIND_STRING: int = 3

## Value kind by name.
var _kinds: Dictionary[String, int] = {}
var _ints: Dictionary[String, int] = {}
var _floats: Dictionary[String, float] = {}
var _strings: Dictionary[String, String] = {}


func clear() -> void:
	_kinds.clear()
	_ints.clear()
	_floats.clear()
	_strings.clear()


func set_int(name: String, value: int) -> void:
	_kinds[name] = _KIND_INT
	_ints[name] = value


func set_float(name: String, value: float) -> void:
	_kinds[name] = _KIND_FLOAT
	_floats[name] = value


func set_string(name: String, value: String) -> void:
	_kinds[name] = _KIND_STRING
	_strings[name] = value


## The value kind of a name; 0 when the name has no value.
func _kind_of(name: String) -> int:
	if not _kinds.has(name):
		return 0
	return _kinds[name]
