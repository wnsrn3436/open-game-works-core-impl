class_name LogEventParam
extends RefCounted
## One parameter of an analytics event: a name and a value of one of the value types. Only the value field of
## `value_type` holds the value.

enum ValueType { INT, FLOAT, STRING, BOOL }

var name: String = ""
var value_type: ValueType = ValueType.INT
## int64 value.
var int_value: int = 0
## float64 value.
var float_value: float = 0.0
var string_value: String = ""
var bool_value: bool = false
