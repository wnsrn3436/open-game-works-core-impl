extends Logger
## Logger of `UnitTestCore` for the engine script runtime errors (`ERROR_TYPE_SCRIPT`): one for each `SCRIPT ERROR:`
## line of the engine output. `_log_error` can run on any thread, so the count is behind a mutex.

var _mutex: Mutex = Mutex.new()
var _total: int = 0


func _log_error(
		_function: String, _file: String, _line: int, _code: String, _rationale: String, _editor_notify: bool,
		error_type: int, _script_backtraces: Array[ScriptBacktrace]
) -> void:
	if error_type != Logger.ERROR_TYPE_SCRIPT:
		return
	_mutex.lock()
	_total += 1
	_mutex.unlock()


## Script runtime errors since this Logger was made.
func total() -> int:
	_mutex.lock()
	var count: int = _total
	_mutex.unlock()
	return count
