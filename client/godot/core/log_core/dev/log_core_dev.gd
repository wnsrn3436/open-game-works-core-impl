class_name LogCoreDev
extends RefCounted
## DEV operations of `LogCore`.


## `listener(level: LogCore.Level, tag: String, message: String)` gets every `warn` and `error` log and every
## LogCore failure before the operation returns. A new listener replaces the old one; `LogCore.release` clears it.
## A custom `Callable` (a lambda or a `bind()`) is refused with a console `error` line of tag `LogCore` and the old
## listener stays: it can stay in a static var at engine exit and be the last reference to its script.
static func set_log_listener(listener: Callable) -> void:
	if listener.is_custom():
		var message: String = "set_log_listener: the listener is a lambda or a bind(); ignored"
		print(LogCore._format_line(LogCore._device_time_ms(), LogCore.Level.ERROR, LogCore._TAG, message, ""))
		return
	LogCore._listener = listener


## LogCore reads the device time and the monotonic time from `clock` instead of the device. Only before `init`;
## `LogCore.release` clears it.
static func set_test_clock(clock: DevTestClock) -> void:
	if LogCore._is_initialized:
		LogCore._report_failure("set_test_clock after init is ignored")
		return
	if clock == null:
		LogCore._test_clock = null
		LogCore._test_monotonic_ms = Callable()
		LogCore._test_device_time_ms = Callable()
		return
	LogCore._test_clock = clock
	LogCore._test_monotonic_ms = _clock_monotonic_ms
	LogCore._test_device_time_ms = _clock_device_time_ms


## Readers of the test clock that `LogCore` calls. Static functions, not lambdas: a lambda of this script still in a
## LogCore static var at engine exit can be the last reference to this script, and freeing it then aborts the engine.
static func _clock_monotonic_ms() -> int:
	var clock: DevTestClock = LogCore._test_clock as DevTestClock
	if clock == null:
		return 0
	return clock.monotonic_ms


static func _clock_device_time_ms() -> int:
	var clock: DevTestClock = LogCore._test_clock as DevTestClock
	if clock == null:
		return 0
	return clock.device_time_ms


## Paths of the log files under the app storage root (`log/log_<n>.txt`) in ascending `<n>`, after a flush.
static func list_log_files() -> PackedStringArray:
	var paths: PackedStringArray = PackedStringArray()
	if not LogCore._is_initialized:
		LogCore._report_failure("list_log_files before init")
		return paths
	LogCore._flush()
	var numbers: Array[int] = []
	if not LogCore._read_numbers(numbers):
		return paths
	for number: int in numbers:
		paths.append("%s/%s%d%s" % [LogCore._LOG_DIR, LogCore._FILE_PREFIX, number, LogCore._FILE_SUFFIX])
	return paths
