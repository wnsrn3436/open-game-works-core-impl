extends RefCounted
## Login token storage: one text item per name in OS secure storage, or in the browser storage of the game origin.
## Operations do not block the main thread and never show an OS authentication screen.

enum Status { OK, NOT_FOUND, DENIED, UNSUPPORTED, FAILED }


## Result of one storage operation.
class Outcome extends RefCounted:
	var status: Status = Status.FAILED
	## Item text of a read that is `OK`.
	var text: String = ""

	func _init(value: Status = Status.FAILED, item: String = "") -> void:
		status = value
		text = item


## Time limit of one operation, ms: `AuthCore.storageCallTimeoutMs`. Set by `AuthCore.init`. An operation past it ends
## `FAILED` and the storage drops it.
var call_timeout_ms: int = 0


## Reads the item `name`.
func read_item(_name: String) -> Outcome:
	return Outcome.new(Status.UNSUPPORTED)


## Writes `text` as the item `name`.
func write_item(_name: String, _text: String) -> Outcome:
	return Outcome.new(Status.UNSUPPORTED)


## Removes the item `name`. A missing item is `NOT_FOUND`.
func remove_item(_name: String) -> Outcome:
	return Outcome.new(Status.UNSUPPORTED)


## Element name of a status, for logs.
static func status_name(status: Status) -> String:
	match status:
		Status.OK:
			return "Ok"
		Status.NOT_FOUND:
			return "NotFound"
		Status.DENIED:
			return "Denied"
		Status.UNSUPPORTED:
			return "Unsupported"
	return "Failed"
