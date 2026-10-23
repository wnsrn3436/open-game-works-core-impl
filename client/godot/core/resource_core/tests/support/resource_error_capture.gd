extends Logger
## `ResourceCore` core test helper: the messages of the `ResourceCore` `error` log lines the console gets while this
## logger is added with `OS.add_logger`. Builds with DEV code print every log line to the console.

const _TAG: String = "ResourceCore"

var _messages: PackedStringArray = PackedStringArray()
var _mutex: Mutex = Mutex.new()


## The engine can log from any thread. A log line is `<time>\t<level>\t<tag>\t<message>\t<stack trace>`.
func _log_message(message: String, _error: bool) -> void:
	var fields: PackedStringArray = message.trim_suffix("\n").split("\t")
	if fields.size() != 5 or fields[1] != "error" or fields[2] != _TAG:
		return
	_mutex.lock()
	_messages.append(fields[3])
	_mutex.unlock()


func messages() -> PackedStringArray:
	_mutex.lock()
	var copy: PackedStringArray = _messages.duplicate()
	_mutex.unlock()
	return copy
