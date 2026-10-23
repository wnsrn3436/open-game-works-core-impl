extends UnitTestCase
## `init` and `release`, operations outside them, the listener, and cleanup when the tree removes the core node.

const LogProbe := preload("res://core/log_core/tests/support/log_probe.gd")
const LogConsoleCapture := preload("res://core/log_core/tests/support/log_console_capture.gd")

var _probe: LogProbe = null
var _saved_root: String = ""


func before_each() -> void:
	super()
	_saved_root = CoreBuildInfo.storage_root
	CoreBuildInfo.storage_root = LogProbe.ROOT
	LogProbe.clean()
	_probe = LogProbe.new()
	_probe.install()


func after_each() -> void:
	super()
	LogCore.release()
	LogProbe.clean()
	CoreBuildInfo.storage_root = _saved_root


static func _file_messages(number: int) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for line: String in LogProbe.read_lines(number):
		out.append(LogProbe.fields(line)[3])
	return out


func test_lifecycle() -> void:
	assert_false(LogCore.is_initialized())
	assert_true(LogCore.init())
	assert_true(LogCore.is_initialized())
	var root: Window = (Engine.get_main_loop() as SceneTree).root
	var node: Node = LogCore._node
	assert_not_null(node)
	assert_eq(node.get_parent(), root)
	LogCore.set_sender(_probe.send)
	LogCore.set_analytics_allowed(true)
	LogCore.log_error("test", "queued")
	assert_true(LogCore.track_event("queued_event", []))
	LogCore.release()
	assert_false(LogCore.is_initialized())
	assert_false(is_instance_valid(node) and node.is_inside_tree())
	assert_null(LogCore._node)
	assert_null(LogCore._session)
	assert_null(LogCore._deferred_session)
	assert_true(LogCore._deferred_work.is_null())
	assert_false(LogCore._flush_due)
	assert_false(LogCore._send_due)
	assert_eq(LogCore._file_max_bytes, 0)
	assert_eq(LogCore._send_interval_ms, 0)
	assert_eq(LogCore._dir_path, "")
	assert_false(LogCore._writing)
	assert_eq(LogCore._current_number, 0)
	assert_eq(LogCore._current_bytes, 0)
	assert_true(LogCore._buffer.is_empty())
	assert_eq(LogCore._buffer_bytes, 0)
	assert_eq(LogCore._buffer_started_ms, 0)
	assert_true(LogCore._errors.is_empty())
	assert_eq(LogCore._dropped_errors, 0)
	assert_true(LogCore._events.is_empty())
	assert_eq(LogCore._dropped_events, 0)
	assert_true(LogCore._sender.is_null())
	assert_false(LogCore._has_sent)
	assert_eq(LogCore._last_send_ms, 0)
	assert_false(LogCore._in_sender)
	assert_false(LogCore._analytics_allowed)
	assert_true(LogCore._rejected_event_names.is_empty())
	assert_true(LogCore._listener.is_null())
	assert_null(LogCore._test_clock)
	assert_true(LogCore._test_monotonic_ms.is_null())
	assert_true(LogCore._test_device_time_ms.is_null())
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 0)


func test_the_tree_removing_the_core_node_cleans_up_like_release() -> void:
	assert_true(LogCore.init())
	LogCore.log_info("test", "buffered")
	var node: Node = LogCore._node
	node.free()
	assert_false(LogCore.is_initialized())
	assert_null(LogCore._node)
	assert_false(FileAccess.file_exists(LogProbe.log_dir() + "/running"))
	assert_eq(_file_messages(1), PackedStringArray(["buffered"]))
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 0)
	_probe.install()
	assert_true(LogCore.init())


func test_operations_before_init_and_after_release_reach_neither_file_nor_sender() -> void:
	LogCore.log_error("test", "before init")
	assert_false(LogCore.track_event("before_init", []))
	LogCore.notify_app_state(LogCore.AppState.QUIT)
	LogCore.set_sender(_probe.send)
	LogCore.clear_sender()
	assert_false(DirAccess.dir_exists_absolute(LogProbe.log_dir()))
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 4)
	assert_eq(_probe.count(LogCore.Level.ERROR, "test"), 0)
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	LogCore.log_error("test", "while initialized")
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	LogCore.release()
	_probe.install()
	LogCore.log_error("test", "after release")
	assert_false(LogCore.track_event("after_release", []))
	LogCore.set_sender(_probe.send)
	LogCore.notify_app_state(LogCore.AppState.BACKGROUND)
	_probe.advance(100000)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	assert_eq(_file_messages(1), PackedStringArray(["while initialized"]))


func test_init_of_an_initialized_logcore_fails_and_changes_nothing() -> void:
	assert_true(LogCore.init())
	LogCore.log_info("test", "info")
	LogCore.log_error("test", "queued")
	var files: PackedStringArray = LogCoreDev.list_log_files()
	var lines: PackedStringArray = LogProbe.read_lines(1)
	var queued: int = LogCore._errors.size()
	assert_false(LogCore.init())
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 1)
	assert_true(LogCore.is_initialized())
	assert_eq(LogCoreDev.list_log_files(), files)
	assert_eq(LogProbe.read_lines(1), lines)
	assert_eq(LogCore._errors.size(), queued)


func test_after_release_and_init_the_old_sender_listener_and_queue_are_gone() -> void:
	var old: LogProbe = _probe
	assert_true(LogCore.init())
	LogCore.log_error("test", "old queue")
	LogCore.set_sender(old.send)
	LogCore.release()
	var listened: int = old.levels.size()
	_probe = LogProbe.new()
	_probe.install()
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	LogCore.log_error("test", "new queue")
	await UnitTestCore.wait_frames(2)
	assert_eq(old.batches.size(), 0)
	assert_eq(old.levels.size(), listened)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1:
		assert_eq(_probe.batches[0].errors.size(), 1)
		if _probe.batches[0].errors.size() == 1:
			assert_eq(_probe.batches[0].errors[0].message, "new queue")


## The test clock stays in LogCore as the object `set_test_clock` got, read through static functions: a lambda of
## another script left in a static var at engine exit makes the engine abort.
func test_set_test_clock_keeps_the_clock_and_reads_it_without_a_lambda() -> void:
	assert_same(LogCore._test_clock, _probe.clock)
	assert_true(LogCore._test_monotonic_ms.is_standard(), "the monotonic time reader is not a lambda")
	assert_true(LogCore._test_device_time_ms.is_standard(), "the device time reader is not a lambda")
	_probe.clock.monotonic_ms = 777
	assert_eq(LogCore._monotonic_ms(), 777)
	assert_eq(LogCore._device_time_ms(), LogProbe.START_DEVICE_TIME_MS)
	_probe.clock.device_time_ms = LogProbe.START_DEVICE_TIME_MS + 5
	assert_eq(LogCore._device_time_ms(), LogProbe.START_DEVICE_TIME_MS + 5, "reads the clock at each call")
	LogCoreDev.set_test_clock(null)
	assert_null(LogCore._test_clock)
	assert_true(LogCore._test_monotonic_ms.is_null() and LogCore._test_device_time_ms.is_null())


func test_a_listener_set_before_init_gets_warn_logs_after_init() -> void:
	var listener: LogProbe = LogProbe.new()
	LogCoreDev.set_log_listener(listener.listen)
	assert_true(LogCore.init())
	LogCore.log_warn("test", "after init")
	assert_eq(listener.count_message(LogCore.Level.WARN, "test", "after init"), 1)


func test_a_lambda_or_a_bound_listener_is_refused_with_a_console_error_line_and_the_old_listener_stays() -> void:
	assert_true(LogCore.init())
	var other: LogProbe = LogProbe.new()
	var capture: LogConsoleCapture = LogConsoleCapture.new()
	OS.add_logger(capture)
	var lambda: Callable = func(level: LogCore.Level, tag: String, message: String) -> void:
		other.listen(level, tag, message)
	LogCoreDev.set_log_listener(lambda)
	LogCoreDev.set_log_listener(other.listen_from.bind("bound"))
	OS.remove_logger(capture)
	var refusals: int = 0
	for message: String in capture.messages():
		var fields: PackedStringArray = LogProbe.fields(message)
		if fields.size() == 5 and fields[1] == "error" and fields[2] == "LogCore":
			if fields[3].begins_with("set_log_listener"):
				refusals += 1
	assert_eq(refusals, 2, "one console error line of tag LogCore for each refused listener")
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 0, "the refusal is a console line only")
	LogCore.log_warn("test", "after the refusals")
	assert_eq(_probe.count_message(LogCore.Level.WARN, "test", "after the refusals"), 1, "the old listener stays")
	assert_eq(other.levels.size(), 0, "a refused listener is never called")
	LogProbe.static_calls = 0
	LogCoreDev.set_log_listener(LogProbe.static_listen)
	LogCore.log_warn("test", "to the static function")
	assert_eq(LogProbe.static_calls, 1, "a static function is kept")
	assert_eq(_probe.count_message(LogCore.Level.WARN, "test", "to the static function"), 0)
	LogCoreDev.set_log_listener(other.listen)
	LogCore.log_warn("test", "to the method reference")
	var kept: int = other.count_message(LogCore.Level.WARN, "test", "to the method reference")
	assert_eq(kept, 1, "a method reference is kept")
	assert_eq(LogProbe.static_calls, 1)
	LogProbe.static_calls = 0


func test_the_listener_gets_warn_and_error_before_the_operation_returns() -> void:
	assert_true(LogCore.init())
	LogCore.log_debug("test", "debug")
	LogCore.log_info("test", "info")
	assert_eq(_probe.levels.size(), 0)
	LogCore.log_warn("test", "warn")
	assert_eq(_probe.levels.size(), 1)
	assert_eq(_probe.count_message(LogCore.Level.WARN, "test", "warn"), 1)
	LogCore.log_error("test", "error")
	assert_eq(_probe.levels.size(), 2)
	assert_eq(_probe.count_message(LogCore.Level.ERROR, "test", "error"), 1)
