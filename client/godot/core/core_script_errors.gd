class_name CoreScriptErrors
extends RefCounted
## Notices a GDScript runtime error while core calls a hook. Not a module. A function that stops on a GDScript runtime
## error returns `false` when it is `-> bool` and `null` otherwise, so the return value cannot tell a throw. A module
## takes `begin()` before the hook call and asks `end()` after it; a GDScript runtime error the engine reported on the
## main thread in between is the hook's throw (`client-core` Godot `## hook`). One `OS.add_logger` Logger counts them;
## it is added at the first `begin()` and stays until the process ends. Event callbacks are not checked this way.


## The Logger: counts the script errors reported on the main thread. Other threads are left out, because core calls
## hooks on the main thread only and `_log_error` can run on any thread.
class _ScriptErrorLogger:
	extends Logger

	func _log_error(
			_function: String, _file: String, _line: int, _code: String, _rationale: String, _editor_notify: bool,
			error_type: int, _script_backtraces: Array[ScriptBacktrace]
	) -> void:
		if error_type == Logger.ERROR_TYPE_SCRIPT and OS.get_thread_caller_id() == OS.get_main_thread_id():
			CoreScriptErrors._count += 1


## Script errors on the main thread since the Logger was added, less those a nested `end()` took.
static var _count: int = 0
static var _logger: _ScriptErrorLogger = null


## Mark before a hook call. Adds the Logger on first use.
static func begin() -> int:
	if _logger == null:
		_logger = _ScriptErrorLogger.new()
		OS.add_logger(_logger)
	return _count


## Whether a GDScript runtime error was reported on the main thread since `mark`, the `begin()` of this hook call. The
## errors become this call's: a hook call around this one does not see them.
static func end(mark: int) -> bool:
	var threw: bool = _count != mark
	_count = mark
	return threw
