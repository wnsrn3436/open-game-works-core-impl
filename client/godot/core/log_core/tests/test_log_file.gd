extends UnitTestCase
## Log files: numbering, size and count limits, flush times, a log folder that cannot be made, and the running
## marker.

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


static func _number_of(path: String) -> int:
	return path.get_file().trim_prefix("log_").trim_suffix(".txt").to_int()


func _make_log_dir() -> void:
	DirAccess.make_dir_recursive_absolute(LogProbe.log_dir())


func test_each_init_writes_the_file_after_the_largest_number() -> void:
	_make_log_dir()
	for file_name: String in ["log_2.txt", "log_02.txt", "log_0.txt", "log_1234567890123456789.txt"]:
		LogProbe.write_file(LogProbe.log_dir() + "/" + file_name, "old\n")
	assert_true(LogCore.init())
	LogCore.log_info("test", "one")
	assert_eq(LogCoreDev.list_log_files(), PackedStringArray(["log/log_2.txt", "log/log_3.txt"]))
	assert_eq(LogProbe.read_lines(3).size(), 1)
	LogCore.release()
	_probe.install()
	assert_true(LogCore.init())
	LogCore.log_info("test", "two")
	assert_eq(LogCoreDev.list_log_files(), PackedStringArray(["log/log_2.txt", "log/log_3.txt", "log/log_4.txt"]))
	assert_eq(LogProbe.read_lines(4).size(), 1)


func test_files_stay_within_the_size_and_count_limits_and_the_oldest_go_first() -> void:
	var max_bytes: int = 200
	var max_count: int = 3
	assert_true(UnitTestCore.set_test_settings("LogCore.fileMaxBytes", max_bytes))
	assert_true(UnitTestCore.set_test_settings("LogCore.fileMaxCount", max_count))
	assert_true(LogCore.init())
	var written: PackedStringArray = PackedStringArray()
	for i: int in 40:
		var message: String = "message %02d" % i
		written.append(message)
		LogCore.log_info("test", message)
	var paths: PackedStringArray = LogCoreDev.list_log_files()
	assert_eq(paths.size(), max_count)
	var kept: PackedStringArray = PackedStringArray()
	var numbers: Array[int] = []
	for path: String in paths:
		var number: int = _number_of(path)
		numbers.append(number)
		assert_lte(FileAccess.get_file_as_bytes(LogProbe.ROOT + path).size(), max_bytes)
		for line: String in LogProbe.read_lines(number):
			kept.append(LogProbe.fields(line)[3])
	assert_gt(numbers[0], 1)
	for i: int in range(1, numbers.size()):
		assert_eq(numbers[i], numbers[i - 1] + 1)
	assert_eq(kept, written.slice(written.size() - kept.size()))
	# A new session starts an empty current log file: room for the lines around the long line.
	LogCore.release()
	_probe.install()
	assert_true(LogCore.init())
	LogCore.log_info("test", "before the long line")
	var before: PackedStringArray = LogCoreDev.list_log_files()
	var newest: int = _number_of(before[before.size() - 1])
	assert_eq(LogProbe.read_lines(newest).size(), 1)
	LogCore.log_info("test", "x".repeat(max_bytes))
	LogCore.log_info("test", "after the long line")
	var after: PackedStringArray = LogCoreDev.list_log_files()
	assert_eq(after, before, "the long line starts no new file")
	var newest_messages: PackedStringArray = PackedStringArray()
	for line: String in LogProbe.read_lines(newest):
		newest_messages.append(LogProbe.fields(line)[3])
	assert_eq(newest_messages, PackedStringArray(["before the long line", "after the long line"]))
	for path: String in after:
		assert_false(FileAccess.get_file_as_string(LogProbe.ROOT + path).contains("x".repeat(max_bytes)))


func test_lines_reach_the_file_at_the_flush_times() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.fileWriteIntervalMs", 1000))
	assert_true(LogCore.init())
	LogCore.log_warn("test", "buffered")
	assert_eq(LogProbe.read_lines(1).size(), 0)
	_probe.advance(999)
	await UnitTestCore.wait_frames(2)
	assert_eq(LogProbe.read_lines(1).size(), 0)
	_probe.advance(1)
	await UnitTestCore.wait_frames(2)
	assert_eq(LogProbe.read_lines(1).size(), 1)
	LogCore.log_info("test", "before the error")
	LogCore.log_error("test", "error")
	assert_eq(LogProbe.read_lines(1).size(), 3)
	LogCore.log_info("test", "background")
	LogCore.notify_app_state(LogCore.AppState.BACKGROUND)
	assert_eq(LogProbe.read_lines(1).size(), 4)
	LogCore.notify_app_state(LogCore.AppState.FOREGROUND)
	LogCore.log_info("test", "quit")
	LogCore.notify_app_state(LogCore.AppState.QUIT)
	assert_eq(LogProbe.read_lines(1).size(), 5)
	LogCore.log_info("test", "release")
	LogCore.release()
	assert_eq(LogProbe.read_lines(1).size(), 6)


func test_a_log_folder_that_cannot_be_made_still_sends_the_errors() -> void:
	DirAccess.make_dir_recursive_absolute(LogProbe.ROOT)
	LogProbe.write_file(LogProbe.log_dir(), "not a folder")
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1:
		assert_gt(_probe.batches[0].errors.size(), 0)
		if _probe.batches[0].errors.size() > 0:
			assert_eq(_probe.batches[0].errors[0].tag, "LogCore")
	LogCore.log_error("test", "after the failure")
	_probe.advance(LogCore._send_interval_ms)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 2)
	if _probe.batches.size() == 2:
		assert_eq(_probe.batches[1].errors.size(), 1)
		if _probe.batches[1].errors.size() == 1:
			assert_eq(_probe.batches[1].errors[0].message, "after the failure")
	assert_eq(LogCoreDev.list_log_files(), PackedStringArray())
	assert_eq(_probe.count_message(LogCore.Level.ERROR, "test", "after the failure"), 1)


func test_init_after_an_end_without_release_logs_abnormal_exit_once() -> void:
	_make_log_dir()
	LogProbe.write_file(LogProbe.log_dir() + "/running", "")
	assert_true(LogCore.init())
	assert_eq(_probe.count_message(LogCore.Level.ERROR, "LogCore", "abnormal exit"), 1)
	assert_true(FileAccess.file_exists(LogProbe.log_dir() + "/running"))
	LogCoreDev.list_log_files()
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 1)
	if lines.size() == 1:
		assert_eq(LogProbe.fields(lines[0])[3], "abnormal exit")
	LogCore.release()
	_probe.install()
	assert_true(LogCore.init())
	assert_eq(_probe.count_message(LogCore.Level.ERROR, "LogCore", "abnormal exit"), 1)


func test_quit_or_background_then_release_leaves_no_marker_and_no_failure() -> void:
	var marker: String = LogProbe.log_dir() + "/running"
	assert_true(LogCore.init())
	assert_true(FileAccess.file_exists(marker))
	LogCore.notify_app_state(LogCore.AppState.QUIT)
	assert_false(FileAccess.file_exists(marker))
	LogCore.release()
	assert_false(FileAccess.file_exists(marker))
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 0)
	_probe.install()
	assert_true(LogCore.init())
	LogCore.notify_app_state(LogCore.AppState.BACKGROUND)
	assert_false(FileAccess.file_exists(marker))
	LogCore.notify_app_state(LogCore.AppState.FOREGROUND)
	assert_true(FileAccess.file_exists(marker))
	LogCore.notify_app_state(LogCore.AppState.BACKGROUND)
	LogCore.release()
	assert_false(FileAccess.file_exists(marker))
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 0)
