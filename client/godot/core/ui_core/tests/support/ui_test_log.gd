extends RefCounted
## What the test panels and popups did, and how they behave. The UICore core tests reset it before each test.

const _GATE := preload("res://core/ui_core/tests/support/ui_test_gate.gd")

## Interface calls in order, as `<key>:<method>[:<reason>[:<cache>]]`.
static var entries: PackedStringArray = PackedStringArray()
## Keys whose `accepts_param` is `false`.
static var refused: Dictionary[String, bool] = {}
## Keys whose `prepare` with reason `NEW` (popups: every `prepare`) is `false`.
static var fail_new: Dictionary[String, bool] = {}
## Keys whose `prepare` with reason `RETURNED` is `false`.
static var fail_returned: Dictionary[String, bool] = {}
## Keys whose `prepare` waits for the gate to open.
static var gates: Dictionary[String, _GATE] = {}
## Caches a panel puts in `UIPanel.cache` in its `prepare`, by key.
static var caches: Dictionary[String, UIPanelCache] = {}
## Params the panels got, by key, at their last `prepare`.
static var params: Dictionary[String, UIParam] = {}


static func reset() -> void:
	entries = PackedStringArray()
	refused = {}
	fail_new = {}
	fail_returned = {}
	gates = {}
	caches = {}
	params = {}


static func add(entry: String) -> void:
	entries.append(entry)


## Entries that start with `prefix`.
static func count(prefix: String) -> int:
	var found: int = 0
	for entry: String in entries:
		if entry.begins_with(prefix):
			found += 1
	return found


static func index_of(entry: String) -> int:
	return entries.find(entry)


## A gate the `prepare` of `key` waits for.
static func add_gate(key: String) -> _GATE:
	var gate: _GATE = _GATE.new()
	gates[key] = gate
	return gate


static func open_reason(reason: UICore.PanelOpenReason) -> String:
	return "NEW" if reason == UICore.PanelOpenReason.NEW else "RETURNED"


static func close_reason(reason: UICore.PanelCloseReason) -> String:
	return "COVERED" if reason == UICore.PanelCloseReason.COVERED else "CLOSED"


static func cache_name(cache: UIPanelCache) -> String:
	if cache == null:
		return "none"
	var named: _CACHE = cache as _CACHE
	return named.label if named != null else "cache"


const _CACHE := preload("res://core/ui_core/tests/support/ui_test_cache.gd")
