extends RefCounted
## Calls of state machine callbacks, in call order, shared by the state probes of one test.

var lines: PackedStringArray = PackedStringArray()


func add(line: String) -> void:
	lines.append(line)


func clear() -> void:
	lines.clear()
