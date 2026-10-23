class_name LogCore
extends RefCounted
## Diagnostic log lines to the log file (and the console of builds with DEV code), and error logs and analytics
## events to the sender that takes them to the server.

enum Level { DEBUG, INFO, WARN, ERROR }
enum AppState { BACKGROUND, FOREGROUND, QUIT }

const _TAG: String = "LogCore"
const _NODE_SCRIPT := preload("res://core/log_core/log_core_node.gd")
## Frames of files under this folder are LogCore frames, except its core tests.
const _MODULE_DIR: String = "res://core/log_core/"
const _TESTS_DIR: String = "res://core/log_core/tests/"
const _LOG_DIR: String = "log"
const _MARKER: String = "running"
const _FILE_PREFIX: String = "log_"
const _FILE_SUFFIX: String = ".txt"
const _MAX_NUMBER_DIGITS: int = 18
const _LEVEL_NAMES: PackedStringArray = ["debug", "info", "warn", "error"]
const _CORE_EVENT_PREFIX: String = "core_"
const _SETTING_KEYS: PackedStringArray = [
	"LogCore.fileMaxBytes",
	"LogCore.fileMaxCount",
	"LogCore.fileWriteIntervalMs",
	"LogCore.sendIntervalMs",
	"LogCore.errorQueueMaxCount",
	"LogCore.eventQueueMaxCount",
	"LogCore.sendTextMaxLength",
	"LogCore.sendTagMaxLength",
	"LogCore.eventNameMaxLength",
	"LogCore.eventParamMaxCount",
	"LogCore.eventParamNameMaxLength",
	"LogCore.eventStringMaxLength",
]

static var _is_initialized: bool = false
static var _node: Node = null
## New object every `init`: deferred work of an earlier session does nothing.
static var _session: RefCounted = null
static var _deferred_session: RefCounted = null
static var _deferred_work: Callable = Callable()
static var _flush_due: bool = false
static var _send_due: bool = false

static var _file_max_bytes: int = 0
static var _file_max_count: int = 0
static var _file_write_interval_ms: int = 0
static var _send_interval_ms: int = 0
static var _error_queue_max_count: int = 0
static var _event_queue_max_count: int = 0
static var _send_text_max_length: int = 0
static var _send_tag_max_length: int = 0
static var _event_name_max_length: int = 0
static var _event_param_max_count: int = 0
static var _event_param_name_max_length: int = 0
static var _event_string_max_length: int = 0

## Log folder path: the app storage root followed by `log`.
static var _dir_path: String = ""
## False after a log file failure until the next `init`: lines no longer go into the write buffer.
static var _writing: bool = false
static var _current_number: int = 0
## UTF-8 bytes appended to the current log file.
static var _current_bytes: int = 0
static var _buffer: PackedStringArray = PackedStringArray()
static var _buffer_bytes: int = 0
## Monotonic time when the first line went into the empty write buffer.
static var _buffer_started_ms: int = 0

static var _errors: Array[LogEntry] = []
static var _dropped_errors: int = 0
static var _events: Array[LogAnalyticsEvent] = []
static var _dropped_events: int = 0
static var _sender: Callable = Callable()
static var _has_sent: bool = false
## Monotonic time of the last sender call.
static var _last_send_ms: int = 0
static var _in_sender: bool = false
static var _analytics_allowed: bool = false
## Event names whose `track_event` failure was logged.
static var _rejected_event_names: Dictionary[String, bool] = {}

## DEV: `set_log_listener`.
static var _listener: Callable = Callable()
## DEV: `set_test_clock`. The test clock, and the static functions of `LogCoreDev` that read its monotonic time and
## device time.
static var _test_clock: RefCounted = null
static var _test_monotonic_ms: Callable = Callable()
static var _test_device_time_ms: Callable = Callable()


static func init() -> bool:
	if _is_initialized:
		_report_failure("init of an initialized LogCore")
		return false
	if not _read_settings():
		return false
	var tree: SceneTree = Engine.get_main_loop() as SceneTree
	if tree == null:
		_report_failure("init without a scene tree")
		return false
	_session = RefCounted.new()
	_deferred_work = _run_deferred_work
	_dir_path = CoreBuildInfo.storage_root + _LOG_DIR
	_writing = true
	_is_initialized = true
	_node = _NODE_SCRIPT.new()
	_node.name = _TAG
	_node.process_mode = Node.PROCESS_MODE_ALWAYS
	tree.root.add_child(_node)
	var dir_error: Error = DirAccess.make_dir_recursive_absolute(_dir_path)
	var abnormal: bool = dir_error == OK and FileAccess.file_exists(_marker_path())
	_create_marker()
	if dir_error != OK:
		_stop_writing("cannot make the log folder: %s" % error_string(dir_error))
	else:
		var numbers: Array[int] = []
		if _read_numbers(numbers):
			_start_file(1 if numbers.is_empty() else numbers[numbers.size() - 1] + 1)
	if abnormal:
		log_error(_TAG, "abnormal exit")
	return true


static func release() -> void:
	if _is_initialized:
		_flush()
		_delete_marker()
	var node: Node = _node
	_reset()
	if node != null and is_instance_valid(node):
		var parent: Node = node.get_parent()
		if parent != null:
			parent.remove_child(node)
		node.queue_free()


static func is_initialized() -> bool:
	return _is_initialized


static func log_debug(tag: String, message: String) -> void:
	_log(Level.DEBUG, tag, message)


static func log_info(tag: String, message: String) -> void:
	_log(Level.INFO, tag, message)


static func log_warn(tag: String, message: String) -> void:
	_log(Level.WARN, tag, message)


static func log_error(tag: String, message: String) -> void:
	_log(Level.ERROR, tag, message)


static func track_event(event_name: String, params: Array[LogEventParam]) -> bool:
	if not _is_initialized:
		_report_failure("track_event before init")
		return false
	if not _analytics_allowed:
		return false
	var problem: String = _event_problem(event_name, params)
	if not problem.is_empty():
		if not _rejected_event_names.has(event_name):
			_rejected_event_names[event_name] = true
			log_error(_TAG, "track_event rejected event %s: %s" % [event_name, problem])
		return false
	if _events.size() >= _event_queue_max_count:
		_dropped_events += 1
		return true
	var event: LogAnalyticsEvent = LogAnalyticsEvent.new()
	event.name = event_name
	event.time = _device_time_ms()
	for param: LogEventParam in params:
		var copy: LogEventParam = LogEventParam.new()
		copy.name = param.name
		copy.value_type = param.value_type
		copy.int_value = param.int_value
		copy.float_value = param.float_value
		copy.string_value = param.string_value
		copy.bool_value = param.bool_value
		event.params.append(copy)
	_events.append(event)
	return true


static func notify_app_state(state: AppState) -> void:
	if not _is_initialized:
		_report_failure("notify_app_state before init")
		return
	match state:
		AppState.BACKGROUND, AppState.QUIT:
			_flush()
			_delete_marker()
		AppState.FOREGROUND:
			_create_marker()
		_:
			log_error(_TAG, "notify_app_state with an unknown app state %d" % state)


static func set_sender(sender: Callable) -> void:
	if not _is_initialized:
		_report_failure("set_sender before init")
		return
	if not sender.is_valid():
		log_error(_TAG, "set_sender with a sender that cannot be called")
		return
	_sender = sender


static func clear_sender() -> void:
	if not _is_initialized:
		_report_failure("clear_sender before init")
		return
	_sender = Callable()


static func set_analytics_allowed(allowed: bool) -> void:
	if not _is_initialized:
		_report_failure("set_analytics_allowed before init")
		return
	if _analytics_allowed and not allowed:
		_events = []
		_dropped_events = 0
	_analytics_allowed = allowed


static func _log(level: Level, tag: String, message: String) -> void:
	var time: int = _device_time_ms()
	var stack_trace: String = _stack_trace() if level == Level.ERROR else ""
	var line: String = _format_line(time, level, tag, message, stack_trace)
	if CoreBuildInfo.has_dev_code:
		print(line)
	if not _is_initialized:
		return
	_put_line(line, level == Level.ERROR)
	if level == Level.ERROR and not _in_sender:
		var entry: LogEntry = LogEntry.new()
		entry.time = time
		entry.level = level
		entry.tag = tag
		entry.message = message
		entry.stack_trace = stack_trace
		_enqueue_error(entry)
	if level == Level.WARN or level == Level.ERROR:
		_call_listener(level, tag, message)


## A failure of LogCore itself that the log operations do not record: the console of builds with DEV code and
## the listener.
static func _report_failure(message: String) -> void:
	if CoreBuildInfo.has_dev_code:
		print(_format_line(_device_time_ms(), Level.ERROR, _TAG, message, ""))
	_call_listener(Level.ERROR, _TAG, message)


static func _call_listener(level: Level, tag: String, message: String) -> void:
	if _listener.is_valid():
		_listener.call(level, tag, message)


## Log line without the final LF: `time`, `level`, `tag`, `message`, `stack_trace` joined with tabs.
static func _format_line(time: int, level: Level, tag: String, message: String, stack_trace: String) -> String:
	return "%d\t%s\t%s\t%s\t%s" % [time, _LEVEL_NAMES[level], _escape(tag), _escape(message), _escape(stack_trace)]


## `\`, tab, LF and CR as `\\`, `\t`, `\n`, `\r`. A Godot `String` never holds U+0000: the engine turns it into
## U+FFFD when it makes the string.
static func _escape(text: String) -> String:
	return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


## The GDScript frames outside LogCore, innermost first, as `<file>:<line> <function>` lines.
static func _stack_trace() -> String:
	var frames: PackedStringArray = PackedStringArray()
	for backtrace: ScriptBacktrace in Engine.capture_script_backtraces():
		for i: int in backtrace.get_frame_count():
			var file: String = backtrace.get_frame_file(i)
			if file.begins_with(_MODULE_DIR) and not file.begins_with(_TESTS_DIR):
				continue
			frames.append("%s:%d %s" % [file, backtrace.get_frame_line(i), backtrace.get_frame_function(i)])
	return "\n".join(frames)


static func _device_time_ms() -> int:
	if _test_device_time_ms.is_valid():
		var test_time: int = _test_device_time_ms.call()
		return test_time
	return int(Time.get_unix_time_from_system() * 1000.0)


static func _monotonic_ms() -> int:
	if _test_monotonic_ms.is_valid():
		var test_time: int = _test_monotonic_ms.call()
		return test_time
	return Time.get_ticks_msec()


static func _read_settings() -> bool:
	var values: Array[int] = []
	for key: String in _SETTING_KEYS:
		if not CoreSettings.has_int(key):
			_report_failure("core settings %s is missing or not an integer" % key)
			return false
		values.append(CoreSettings.get_int(key))
	_file_max_bytes = values[0]
	_file_max_count = values[1]
	_file_write_interval_ms = values[2]
	_send_interval_ms = values[3]
	_error_queue_max_count = values[4]
	_event_queue_max_count = values[5]
	_send_text_max_length = values[6]
	_send_tag_max_length = values[7]
	_event_name_max_length = values[8]
	_event_param_max_count = values[9]
	_event_param_name_max_length = values[10]
	_event_string_max_length = values[11]
	return true


static func _event_problem(event_name: String, params: Array[LogEventParam]) -> String:
	if not UtilCore.is_snake_case(event_name):
		return "the name is not snake_case"
	if event_name.length() > _event_name_max_length:
		return "the name is longer than LogCore.eventNameMaxLength"
	if event_name.begins_with(_CORE_EVENT_PREFIX):
		return "the name starts with core_"
	if params.size() > _event_param_max_count:
		return "more parameters than LogCore.eventParamMaxCount"
	var names: Dictionary[String, bool] = {}
	for param: LogEventParam in params:
		if param == null:
			return "a parameter is null"
		if not UtilCore.is_snake_case(param.name):
			return "a parameter name is not snake_case"
		if param.name.length() > _event_param_name_max_length:
			return "a parameter name is longer than LogCore.eventParamNameMaxLength"
		if names.has(param.name):
			return "two parameters are named %s" % param.name
		names[param.name] = true
		match param.value_type:
			LogEventParam.ValueType.INT, LogEventParam.ValueType.BOOL:
				pass
			LogEventParam.ValueType.FLOAT:
				if is_nan(param.float_value) or is_inf(param.float_value):
					return "parameter %s is NaN or infinite" % param.name
			LogEventParam.ValueType.STRING:
				if param.string_value.length() > _event_string_max_length:
					return "parameter %s is longer than LogCore.eventStringMaxLength" % param.name
			_:
				return "parameter %s has an unknown value type" % param.name
	return ""


## Puts the message, stack trace and tag cut to the send lengths into the error queue, or counts it as dropped.
static func _enqueue_error(entry: LogEntry) -> void:
	if _errors.size() >= _error_queue_max_count:
		_dropped_errors += 1
		return
	entry.tag = entry.tag.substr(0, _send_tag_max_length)
	entry.message = entry.message.substr(0, _send_text_max_length)
	entry.stack_trace = entry.stack_trace.substr(0, _send_text_max_length)
	_errors.append(entry)


static func _marker_path() -> String:
	return _dir_path + "/" + _MARKER


static func _file_path(number: int) -> String:
	return "%s/%s%d%s" % [_dir_path, _FILE_PREFIX, number, _FILE_SUFFIX]


static func _create_marker() -> void:
	var file: FileAccess = FileAccess.open(_marker_path(), FileAccess.WRITE)
	if file == null:
		_report_failure("cannot make the running marker: %s" % error_string(FileAccess.get_open_error()))
		return
	file.close()


static func _delete_marker() -> void:
	var path: String = _marker_path()
	if not FileAccess.file_exists(path):
		return
	var error: Error = DirAccess.remove_absolute(path)
	if error != OK:
		_report_failure("cannot delete the running marker: %s" % error_string(error))


## The log file numbers in the log folder in ascending order. `false` (and log file writing stops) when the
## folder cannot be read.
static func _read_numbers(out: Array[int]) -> bool:
	var dir: DirAccess = DirAccess.open(_dir_path)
	if dir == null:
		_stop_writing("cannot read the log folder: %s" % error_string(DirAccess.get_open_error()))
		return false
	for file_name: String in dir.get_files():
		var number: int = _number_of(file_name)
		if number > 0:
			out.append(number)
	out.sort()
	return true


## `<n>` of a log file name `log_<n>.txt`: 1 to 18 decimal digits not starting with 0. 0 for other names.
static func _number_of(file_name: String) -> int:
	if not file_name.begins_with(_FILE_PREFIX) or not file_name.ends_with(_FILE_SUFFIX):
		return 0
	var digits: String = file_name.substr(_FILE_PREFIX.length(), file_name.length() - _FILE_PREFIX.length() - _FILE_SUFFIX.length())
	if digits.is_empty() or digits.length() > _MAX_NUMBER_DIGITS or digits.begins_with("0"):
		return 0
	for i: int in digits.length():
		var c: int = digits.unicode_at(i)
		if c < 48 or c > 57:
			return 0
	return digits.to_int()


## Starts the empty file `log_<number>.txt` as the current log file, then deletes the files with the smallest
## numbers while there are more than `LogCore.fileMaxCount`.
static func _start_file(number: int) -> bool:
	_current_number = number
	_current_bytes = 0
	var file: FileAccess = FileAccess.open(_file_path(number), FileAccess.WRITE)
	if file == null:
		_stop_writing("cannot make a log file: %s" % error_string(FileAccess.get_open_error()))
		return false
	file.close()
	var numbers: Array[int] = []
	if not _read_numbers(numbers):
		return false
	var excess: int = numbers.size() - _file_max_count
	for i: int in maxi(excess, 0):
		var error: Error = DirAccess.remove_absolute(_file_path(numbers[i]))
		if error != OK:
			_stop_writing("cannot delete an old log file: %s" % error_string(error))
			return false
	return true


## Puts a log line into the write buffer, first starting a new file when the line does not fit the current one.
static func _put_line(line: String, flush_now: bool) -> void:
	if not _writing:
		return
	var text: String = line + "\n"
	var bytes: int = text.to_utf8_buffer().size()
	if bytes > _file_max_bytes:
		return
	if _current_bytes + _buffer_bytes + bytes > _file_max_bytes:
		if not _flush() or not _start_file(_current_number + 1):
			return
	if _buffer.is_empty():
		_buffer_started_ms = _monotonic_ms()
	_buffer.append(text)
	_buffer_bytes += bytes
	if flush_now:
		_flush()


## Appends the write buffer to the current log file at once and empties it.
static func _flush() -> bool:
	if _buffer.is_empty():
		return true
	var file: FileAccess = FileAccess.open(_file_path(_current_number), FileAccess.READ_WRITE)
	if file == null:
		_stop_writing("cannot open the log file: %s" % error_string(FileAccess.get_open_error()))
		return false
	file.seek_end()
	var stored: bool = file.store_string("".join(_buffer))
	file.close()
	if not stored:
		_stop_writing("cannot write the log file")
		return false
	_current_bytes += _buffer_bytes
	_buffer = PackedStringArray()
	_buffer_bytes = 0
	return true


## Stops log file writing until the next `init` and puts a LogCore entry into the error queue.
static func _stop_writing(reason: String) -> void:
	_writing = false
	_buffer = PackedStringArray()
	_buffer_bytes = 0
	var entry: LogEntry = LogEntry.new()
	entry.time = _device_time_ms()
	entry.tag = _TAG
	entry.message = reason
	if CoreBuildInfo.has_dev_code:
		print(_format_line(entry.time, Level.ERROR, _TAG, reason, ""))
	_enqueue_error(entry)


## Frame code of the core node: only compares times and defers the flush and the sender call.
static func _on_frame() -> void:
	if not _is_initialized:
		return
	var now: int = _monotonic_ms()
	if not _buffer.is_empty() and now - _buffer_started_ms >= _file_write_interval_ms:
		_flush_due = true
	if not _sender.is_null() and (not _errors.is_empty() or not _events.is_empty()):
		if not _has_sent or now - _last_send_ms >= _send_interval_ms:
			_send_due = true
	if (_flush_due or _send_due) and _deferred_session != _session:
		_deferred_session = _session
		_deferred_work.call_deferred()


static func _run_deferred_work() -> void:
	if _session == null or _deferred_session != _session:
		return
	_deferred_session = null
	if _flush_due:
		_flush_due = false
		_flush()
	if _send_due:
		_send_due = false
		_send()


static func _send() -> void:
	if _sender.is_null() or (_errors.is_empty() and _events.is_empty()):
		return
	if not _sender.is_valid():
		_sender = Callable()
		log_error(_TAG, "the sender object is gone")
		return
	var batch: LogBatch = LogBatch.new()
	batch.errors = _errors
	batch.dropped_error_count = _dropped_errors
	batch.events = _events
	batch.dropped_event_count = _dropped_events
	_errors = []
	_dropped_errors = 0
	_events = []
	_dropped_events = 0
	_has_sent = true
	_last_send_ms = _monotonic_ms()
	var session: RefCounted = _session
	_in_sender = true
	_sender.call(batch)
	if session == _session:
		_in_sender = false


## The tree removed the core node outside `release` (app exit): the same cleanup without `remove_child`.
static func _on_node_exit() -> void:
	var node: Node = _node
	if _is_initialized:
		_flush()
		_delete_marker()
	_reset()
	if not node.is_queued_for_deletion():
		node.queue_free()


## Every static var back to its initial value.
static func _reset() -> void:
	_is_initialized = false
	_node = null
	_session = null
	_deferred_session = null
	_deferred_work = Callable()
	_flush_due = false
	_send_due = false
	_file_max_bytes = 0
	_file_max_count = 0
	_file_write_interval_ms = 0
	_send_interval_ms = 0
	_error_queue_max_count = 0
	_event_queue_max_count = 0
	_send_text_max_length = 0
	_send_tag_max_length = 0
	_event_name_max_length = 0
	_event_param_max_count = 0
	_event_param_name_max_length = 0
	_event_string_max_length = 0
	_dir_path = ""
	_writing = false
	_current_number = 0
	_current_bytes = 0
	_buffer = PackedStringArray()
	_buffer_bytes = 0
	_buffer_started_ms = 0
	_errors = []
	_dropped_errors = 0
	_events = []
	_dropped_events = 0
	_sender = Callable()
	_has_sent = false
	_last_send_ms = 0
	_in_sender = false
	_analytics_allowed = false
	_rejected_event_names = {}
	_listener = Callable()
	_test_clock = null
	_test_monotonic_ms = Callable()
	_test_device_time_ms = Callable()
