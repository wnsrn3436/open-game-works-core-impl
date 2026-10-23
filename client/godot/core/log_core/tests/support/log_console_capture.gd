extends Logger
## LogCore core test helper: the console messages the engine logs while this logger is added with `OS.add_logger`.

var _messages: PackedStringArray = PackedStringArray()
var _mutex: Mutex = Mutex.new()


## The engine can log from any thread.
func _log_message(message: String, _error: bool) -> void:
	_mutex.lock()
	_messages.append(message.trim_suffix("\n"))
	_mutex.unlock()


func messages() -> PackedStringArray:
	_mutex.lock()
	var copy: PackedStringArray = _messages.duplicate()
	_mutex.unlock()
	return copy
