extends "res://core/auth_core/adapters/token_storage.gd"
## Login token storage of the core tests: items in memory, scripted failures and held operations.

signal released

## Items by name.
var items: Dictionary[String, String] = {}
## Status the next operations of a kind return instead of their real result, in order.
var read_script: Array[Status] = []
var write_script: Array[Status] = []
var remove_script: Array[Status] = []
## Operations in start order: `<kind> <name>`.
var calls: PackedStringArray = []
## Operations in end order.
var ended: PackedStringArray = []
## While true, operations wait for `release_held`.
var hold: bool = false


func read_item(name: String) -> Outcome:
	var status: Status = await _begin("read", name)
	if status != Status.OK:
		return _end("read", name, Outcome.new(status))
	if not items.has(name):
		return _end("read", name, Outcome.new(Status.NOT_FOUND))
	return _end("read", name, Outcome.new(Status.OK, items[name]))


func write_item(name: String, text: String) -> Outcome:
	var status: Status = await _begin("write", name)
	if status == Status.OK:
		items[name] = text
	return _end("write", name, Outcome.new(status))


func remove_item(name: String) -> Outcome:
	var status: Status = await _begin("remove", name)
	if status != Status.OK:
		return _end("remove", name, Outcome.new(status))
	if not items.has(name):
		return _end("remove", name, Outcome.new(Status.NOT_FOUND))
	items.erase(name)
	return _end("remove", name, Outcome.new(Status.OK))


## Ends the held operations.
func release_held() -> void:
	hold = false
	released.emit()


## Makes the next operation of `kind` (`read`, `write`, `remove`) return `status`.
func script(kind: String, status: Status) -> void:
	_queue(kind).append(status)


func count(kind: String) -> int:
	var total: int = 0
	for call: String in calls:
		if call.begins_with(kind + " "):
			total += 1
	return total


func _begin(kind: String, name: String) -> Status:
	calls.append("%s %s" % [kind, name])
	if hold:
		await released
	var queue: Array[Status] = _queue(kind)
	if queue.is_empty():
		return Status.OK
	return queue.pop_front()


func _queue(kind: String) -> Array[Status]:
	if kind == "read":
		return read_script
	if kind == "write":
		return write_script
	return remove_script


func _end(kind: String, name: String, outcome: Outcome) -> Outcome:
	ended.append("%s %s" % [kind, name])
	return outcome
