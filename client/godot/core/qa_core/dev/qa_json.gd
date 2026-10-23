extends RefCounted
## JSON text writer of `QACore`. Every function returns the JSON text of one value.

const NULL: String = "null"


static func text(value: String) -> String:
	return JSON.stringify(value)


static func integer(value: int) -> String:
	return str(value)


static func boolean(value: bool) -> String:
	return "true" if value else "false"


## A finite number; NaN and infinity become 0.
static func number(value: float) -> String:
	if is_nan(value) or is_inf(value):
		return "0"
	if value == floorf(value) and absf(value) < 1e15:
		return str(int(value))
	return JSON.stringify(value)


## `"key":<json>`, one member of an object.
static func pair(key: String, json: String) -> String:
	return JSON.stringify(key) + ":" + json


static func object(pairs: PackedStringArray) -> String:
	return "{" + ",".join(pairs) + "}"


static func array(items: PackedStringArray) -> String:
	return "[" + ",".join(items) + "]"


static func strings(values: PackedStringArray) -> String:
	var items: PackedStringArray = PackedStringArray()
	for value: String in values:
		items.append(text(value))
	return array(items)


## `[x, y, w, h]`.
static func rect(value: Rect2) -> String:
	return array(PackedStringArray([
		number(value.position.x), number(value.position.y), number(value.size.x), number(value.size.y),
	]))


## `[w, h]`.
static func size(value: Vector2i) -> String:
	return array(PackedStringArray([integer(value.x), integer(value.y)]))
