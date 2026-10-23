extends FormatArgs
## `FormatArgs` that keeps a text copy of what it holds, through the public `FormatArgs` operations only.

## `<kind>:<value>` by name: `i` integer, `f` real, `s` string.
var values: Dictionary[String, String] = {}


func clear() -> void:
	values.clear()
	super()


func set_int(name: String, value: int) -> void:
	values[name] = "i:%d" % value
	super(name, value)


func set_float(name: String, value: float) -> void:
	values[name] = "f:%s" % value
	super(name, value)


func set_string(name: String, value: String) -> void:
	values[name] = "s:" + value
	super(name, value)
