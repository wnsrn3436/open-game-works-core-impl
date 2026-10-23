extends UnitTestCase
## Log lines in the log file: order and format, escapes, stack traces and the times of the test clock.

const LogProbe := preload("res://core/log_core/tests/support/log_probe.gd")

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


func test_log_lines_follow_the_call_order_and_the_line_format() -> void:
	assert_true(LogCore.init())
	var time: int = _probe.clock.device_time_ms
	LogCore.log_debug("alpha", "first")
	LogCore.log_info("beta", "second")
	LogCore.log_warn("gamma", "third")
	LogCore.log_error("delta", "fourth")
	assert_eq(LogCoreDev.list_log_files(), PackedStringArray(["log/log_1.txt"]))
	var text: String = FileAccess.get_file_as_string(LogProbe.file_path(1))
	assert_true(text.ends_with("\n"))
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 4)
	if lines.size() != 4:
		return
	assert_eq(lines[0], "%d\tdebug\talpha\tfirst\t" % time)
	assert_eq(lines[1], "%d\tinfo\tbeta\tsecond\t" % time)
	assert_eq(lines[2], "%d\twarn\tgamma\tthird\t" % time)
	var error_fields: PackedStringArray = LogProbe.fields(lines[3])
	assert_eq(error_fields.size(), 5)
	if error_fields.size() == 5:
		assert_eq(error_fields[0], str(time))
		assert_eq(error_fields[1], "error")
		assert_eq(error_fields[2], "delta")
		assert_eq(error_fields[3], "fourth")


## A Godot `String` cannot hold U+0000 (the engine turns it into U+FFFD), so only the other four characters reach
## LogCore.
func test_escaped_tag_and_message_stay_on_one_line_and_unescape_to_the_original() -> void:
	assert_true(LogCore.init())
	var tag: String = "t\ta\\g\r"
	var message: String = "one\ntwo\r\tthree\\n\\"
	LogCore.log_warn(tag, message)
	LogCoreDev.list_log_files()
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 1)
	if lines.size() != 1:
		return
	var fields: PackedStringArray = LogProbe.fields(lines[0])
	assert_eq(fields.size(), 5)
	if fields.size() == 5:
		assert_eq(LogProbe.unescape(fields[2]), tag)
		assert_eq(LogProbe.unescape(fields[3]), message)


func test_only_error_lines_have_a_stack_trace_starting_at_the_call() -> void:
	assert_true(LogCore.init())
	LogCore.log_info("test", "info")
	LogCore.log_warn("test", "warn")
	var here: Array[ScriptBacktrace] = Engine.capture_script_backtraces()
	LogCore.log_error("test", "error")
	LogCoreDev.list_log_files()
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 3)
	if lines.size() != 3:
		return
	assert_eq(LogProbe.fields(lines[0])[4], "")
	assert_eq(LogProbe.fields(lines[1])[4], "")
	var stack: String = LogProbe.unescape(LogProbe.fields(lines[2])[4])
	if here.is_empty() or here[0].get_frame_count() == 0:
		assert_eq(stack, "")
		return
	var frames: PackedStringArray = stack.split("\n")
	var call: String = "%s:%d %s" % [here[0].get_frame_file(0), here[0].get_frame_line(0) + 1, here[0].get_frame_function(0)]
	assert_eq(frames[0], call)
	assert_false(stack.contains("res://core/log_core/log_core.gd"))


func test_test_clock_gives_the_line_time_and_the_interval_times() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.fileWriteIntervalMs", 1000))
	assert_true(UnitTestCore.set_test_settings("LogCore.sendIntervalMs", 5000))
	_probe.clock.device_time_ms = 1700000123456
	assert_true(LogCore.init())
	LogCore.log_warn("test", "timed")
	_probe.clock.device_time_ms += 100000
	await UnitTestCore.wait_frames(2)
	assert_eq(LogProbe.read_lines(1).size(), 0)
	_probe.clock.monotonic_ms += 1000
	await UnitTestCore.wait_frames(2)
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 1)
	if lines.size() == 1:
		assert_eq(LogProbe.fields(lines[0])[0], "1700000123456")
	LogCore.set_sender(_probe.send)
	LogCore.log_error("test", "first")
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	LogCore.log_error("test", "second")
	_probe.clock.device_time_ms += 100000
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	_probe.clock.monotonic_ms += 5000
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 2)
