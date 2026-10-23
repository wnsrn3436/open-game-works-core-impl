extends RefCounted
## One local data value: a key's value type and the field of that type.

## One of the `LocalDataCore._TYPE_*` tags.
var value_type: int = 0
var int_value: int = 0
var float_value: float = 0.0
var bool_value: bool = false
var string_value: String = ""
var int_array: PackedInt64Array = PackedInt64Array()
var float_array: PackedFloat64Array = PackedFloat64Array()
var bool_array: Array[bool] = []
var string_array: PackedStringArray = PackedStringArray()
