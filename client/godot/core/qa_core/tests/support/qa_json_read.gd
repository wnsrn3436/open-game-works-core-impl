extends RefCounted
## Reads values out of the JSON text of a `QACore` command result for the QACore core tests. A path is the member
## names and array indexes from the top value, separated by `.`. Example: `inputs.0.latency_ms`.


## The JSON text of the value at `path`; empty when there is none.
# ogw:input_boundary
static func at(json: String, path: String) -> String:
	var out: Array = []
	if not _find(json, path, out):
		return ""
	return JSON.stringify(out[0])


static func has(json: String, path: String) -> bool:
	return not at(json, path).is_empty()


static func is_null(json: String, path: String) -> bool:
	return at(json, path) == "null"


# ogw:input_boundary
static func integer(json: String, path: String) -> int:
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	if value is int:
		return value
	if value is float:
		var number: float = value
		return int(number)
	return -999999


# ogw:input_boundary
static func number(json: String, path: String) -> float:
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	if value is int or value is float:
		var number: float = value
		return number
	return NAN


# ogw:input_boundary
static func text(json: String, path: String) -> String:
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	return value if value is String else "<not a string>"


# ogw:input_boundary
static func boolean(json: String, path: String) -> bool:
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	return value is bool and value == true


## Element count of the array or member count of the object at `path`; -1 when it is neither.
# ogw:input_boundary
static func count(json: String, path: String) -> int:
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	if value is Array:
		var items: Array = value
		return items.size()
	if value is Dictionary:
		var members: Dictionary = value
		return members.size()
	return -1


## Member names of the object at `path`, in order.
# ogw:input_boundary
static func keys(json: String, path: String) -> PackedStringArray:
	var names: PackedStringArray = PackedStringArray()
	var out: Array = []
	var value: Variant = out[0] if _find(json, path, out) else &"<missing>"
	if value is Dictionary:
		var members: Dictionary = value
		for key: Variant in members.keys():
			names.append(str(key))
	return names


## The four numbers of a `[x, y, w, h]` rectangle at `path`.
static func rect(json: String, path: String) -> Rect2:
	var prefix: String = path + "." if not path.is_empty() else ""
	return Rect2(number(json, prefix + "0"), number(json, prefix + "1"), number(json, prefix + "2"), number(json, prefix + "3"))


## Puts the value at `path` into `out` as its only element. False when there is none.
# ogw:input_boundary
static func _find(json: String, path: String, out: Array) -> bool:
	var parser: JSON = JSON.new()
	if parser.parse(json) != OK:
		return false
	var value: Variant = parser.data
	if not path.is_empty():
		for part: String in path.split("."):
			if value is Dictionary:
				var members: Dictionary = value
				if not members.has(part):
					return false
				value = members[part]
			elif value is Array and part.is_valid_int():
				var items: Array = value
				var index: int = part.to_int()
				if index < 0 or index >= items.size():
					return false
				value = items[index]
			else:
				return false
	out.append(value)
	return true
