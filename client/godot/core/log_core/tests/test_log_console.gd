extends UnitTestCase
## The console: log lines of builds with DEV code, log operations outside `init` and `release`, and LogCore failures.

const LogProbe := preload("res://core/log_core/tests/support/log_probe.gd")
const LogConsoleCapture := preload("res://core/log_core/tests/support/log_console_capture.gd")

var _probe: LogProbe = null
var _saved_root: String = ""
var _saved_dev_code: bool = false
var _capture: LogConsoleCapture = null


func before_each() -> void:
	super()
	_saved_root = CoreBuildInfo.storage_root
	_saved_dev_code = CoreBuildInfo.has_dev_code
	CoreBuildInfo.storage_root = LogProbe.ROOT
	CoreBuildInfo.has_dev_code = true
	LogProbe.clean()
	_probe = LogProbe.new()
	_probe.install()
	_capture = LogConsoleCapture.new()
	OS.add_logger(_capture)


func after_each() -> void:
	OS.remove_logger(_capture)
	CoreBuildInfo.has_dev_code = _saved_dev_code
	super()
	LogCore.release()
	LogProbe.clean()
	CoreBuildInfo.storage_root = _saved_root


## Console messages that are log lines of `level` and `tag`.
func _console_lines(level: String, tag: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for message: String in _capture.messages():
		var fields: PackedStringArray = LogProbe.fields(message)
		if fields.size() == 5 and fields[1] == level and fields[2] == tag:
			out.append(message)
	return out


func _console_messages(level: String, tag: String) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for line: String in _console_lines(level, tag):
		out.append(LogProbe.fields(line)[3])
	return out


func test_builds_with_dev_code_write_each_log_line_to_the_console() -> void:
	assert_true(LogCore.init())
	LogCore.log_debug("test", "debug line")
	LogCore.log_info("test", "info line")
	LogCore.log_warn("test", "warn line")
	LogCore.log_error("test", "error line")
	LogCoreDev.list_log_files()
	var file_lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(file_lines.size(), 4)
	for level: String in ["debug", "info", "warn", "error"]:
		assert_eq(_console_messages(level, "test"), PackedStringArray(["%s line" % level]), level)
	var console: PackedStringArray = _capture.messages()
	for line: String in file_lines:
		assert_true(console.has(line), "the console line is the log line: %s" % line)


func test_builds_without_dev_code_write_nothing_to_the_console() -> void:
	CoreBuildInfo.has_dev_code = false
	LogCore.log_warn("test", "before init")
	assert_true(LogCore.init())
	LogCore.log_debug("test", "debug line")
	LogCore.log_info("test", "info line")
	LogCore.log_warn("test", "warn line")
	LogCore.log_error("test", "error line")
	assert_false(LogCore.init())
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 1)
	LogCoreDev.list_log_files()
	assert_eq(LogProbe.read_lines(1).size(), 4)
	for level: String in ["debug", "info", "warn", "error"]:
		assert_eq(_console_lines(level, "test").size(), 0, level)
	assert_eq(_console_lines("error", "LogCore").size(), 0)


func test_log_operations_before_init_and_after_release_go_to_the_console_only() -> void:
	LogCore.log_warn("test", "before init")
	LogCore.log_error("test", "error before init")
	assert_eq(_console_messages("warn", "test"), PackedStringArray(["before init"]))
	assert_eq(_console_messages("error", "test"), PackedStringArray(["error before init"]))
	assert_eq(_probe.count(LogCore.Level.WARN, "test") + _probe.count(LogCore.Level.ERROR, "test"), 0)
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	LogCore.release()
	LogCore.log_info("test", "after release")
	LogCore.log_error("test", "error after release")
	assert_eq(_console_messages("info", "test"), PackedStringArray(["after release"]))
	assert_eq(_console_messages("error", "test"), PackedStringArray(["error before init", "error after release"]))
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 0)
	assert_eq(LogProbe.read_lines(1).size(), 0)


func test_a_logcore_failure_is_a_console_error_line_of_tag_logcore() -> void:
	assert_false(LogCore.track_event("before_init", []))
	assert_eq(_console_lines("error", "LogCore").size(), 1)
	assert_true(LogCore.init())
	assert_eq(_console_lines("error", "LogCore").size(), 1)
	assert_false(LogCore.init())
	assert_eq(_console_lines("error", "LogCore").size(), 2)
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 2, "the listener gets each failure too")
	LogCoreDev.list_log_files()
	assert_eq(LogProbe.read_lines(1).size(), 0, "a LogCore failure is not a log line in the file")
