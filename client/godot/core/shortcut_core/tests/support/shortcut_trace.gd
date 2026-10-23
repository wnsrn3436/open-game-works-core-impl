extends RefCounted
## Shared record of the ShortcutCore core tests: the test hooks, scenes, panels and the event probe append what
## happened, in order, and the tests read it or wait for an entry.

const PREFAB_PREFIX: String = "prefab/shortcut_test_"
const SCENE_PREFIX: String = "scene/shortcut_test_"

static var entries: PackedStringArray = PackedStringArray()


static func add(entry: String) -> void:
	entries.append(entry)


static func clear() -> void:
	entries = PackedStringArray()


static func has(entry: String) -> bool:
	return entries.has(entry)


static func count(entry: String) -> int:
	return entries.count(entry)


## Index of the first `entry`; -1 when it is not there.
static func index(entry: String) -> int:
	return entries.find(entry)


## Entries that start with `prefix`, in order.
static func with_prefix(prefix: String) -> PackedStringArray:
	var found: PackedStringArray = PackedStringArray()
	for entry: String in entries:
		if entry.begins_with(prefix):
			found.append(entry)
	return found


## Short name of a test panel key or test scene key: the key without the test prefix.
static func short(key: String) -> String:
	if key.begins_with(PREFAB_PREFIX):
		return key.substr(PREFAB_PREFIX.length())
	if key.begins_with(SCENE_PREFIX):
		return key.substr(SCENE_PREFIX.length())
	return key
