extends RefCounted
## Shared record of the SceneCore core tests: the test scenes, loading screens, panels and event subscribers append
## what happened, in order, and the tests read it or wait for an entry.

static var entries: PackedStringArray = PackedStringArray()


static func add(entry: String) -> void:
	entries.append(entry)


static func clear() -> void:
	entries = PackedStringArray()


static func has(entry: String) -> bool:
	return entries.has(entry)


## Number of entries equal to `entry`.
static func count(entry: String) -> int:
	return entries.count(entry)
