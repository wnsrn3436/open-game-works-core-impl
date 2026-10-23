extends UnitTestCase
## The sender: what a `LogBatch` holds, when the sender is called, and the lengths it cuts.

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


static func _messages(batch: LogBatch) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for entry: LogEntry in batch.errors:
		out.append(entry.message)
	return out


func test_batches_hold_only_errors_and_events_at_the_send_interval() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.errorQueueMaxCount", 3))
	assert_true(UnitTestCore.set_test_settings("LogCore.sendIntervalMs", 5000))
	assert_true(LogCore.init())
	LogCore.set_analytics_allowed(true)
	LogCore.log_debug("test", "debug")
	LogCore.log_info("test", "info")
	LogCore.log_warn("test", "warn")
	assert_true(LogCore.track_event("stage_clear", []))
	for i: int in 5:
		LogCore.log_error("test", "first %d" % i)
	LogCore.set_sender(_probe.send)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() != 1:
		return
	var first: LogBatch = _probe.batches[0]
	assert_eq(_messages(first), PackedStringArray(["first 0", "first 1", "first 2"]))
	assert_eq(first.dropped_error_count, 2)
	for entry: LogEntry in first.errors:
		assert_eq(entry.level, LogCore.Level.ERROR)
	assert_eq(first.events.size(), 1)
	if first.events.size() == 1:
		assert_eq(first.events[0].name, "stage_clear")
	assert_eq(first.dropped_event_count, 0)
	for i: int in 4:
		LogCore.log_error("test", "second %d" % i)
	_probe.advance(4999)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	_probe.advance(1)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 2)
	if _probe.batches.size() != 2:
		return
	assert_gte(_probe.send_times[1] - _probe.send_times[0], 5000)
	assert_eq(_messages(_probe.batches[1]), PackedStringArray(["second 0", "second 1", "second 2"]))
	assert_eq(_probe.batches[1].dropped_error_count, 1)
	assert_eq(_probe.batches[1].events.size(), 0)


func test_the_sender_is_called_on_a_frame_and_not_after_clear_sender() -> void:
	assert_true(LogCore.init())
	LogCore.set_analytics_allowed(true)
	LogCore.log_error("test", "before the sender")
	LogCore.set_sender(_probe.send)
	LogCore.log_error("test", "with the sender")
	assert_eq(_probe.batches.size(), 0)
	assert_true(LogCore.track_event("tap", []))
	assert_eq(_probe.batches.size(), 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1:
		assert_eq(_messages(_probe.batches[0]), PackedStringArray(["before the sender", "with the sender"]))
	LogCore.clear_sender()
	LogCore.log_error("test", "after clear_sender")
	_probe.advance(LogCore._send_interval_ms * 2)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)


func test_an_error_logged_during_the_sender_call_is_only_in_the_file() -> void:
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	_probe.error_in_sender = "logged in the sender"
	LogCore.log_error("test", "outer")
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	_probe.error_in_sender = ""
	LogCore.log_error("test", "later")
	_probe.advance(LogCore._send_interval_ms)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 2)
	for batch: LogBatch in _probe.batches:
		assert_false(_messages(batch).has("logged in the sender"))
	if _probe.batches.size() == 2:
		assert_eq(_messages(_probe.batches[1]), PackedStringArray(["later"]))
	LogCoreDev.list_log_files()
	var messages: PackedStringArray = PackedStringArray()
	for line: String in LogProbe.read_lines(1):
		messages.append(LogProbe.fields(line)[3])
	assert_true(messages.has("logged in the sender"))


func test_batch_text_and_tag_are_cut_to_the_send_lengths_in_code_points() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.sendTextMaxLength", 5))
	assert_true(UnitTestCore.set_test_settings("LogCore.sendTagMaxLength", 3))
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	var tag: String = "가나다라마"
	var message: String = "😀😀😀😀😀😀😀"
	LogCore.log_error(tag, message)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1 and _probe.batches[0].errors.size() == 1:
		var entry: LogEntry = _probe.batches[0].errors[0]
		assert_eq(entry.tag, "가나다")
		assert_eq(entry.message, "😀😀😀😀😀")
		assert_lte(entry.stack_trace.length(), 5)
	LogCoreDev.list_log_files()
	var lines: PackedStringArray = LogProbe.read_lines(1)
	assert_eq(lines.size(), 1)
	if lines.size() == 1:
		assert_eq(LogProbe.fields(lines[0])[2], tag)
		assert_eq(LogProbe.fields(lines[0])[3], message)


func test_a_full_event_queue_drops_the_event_and_counts_it() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.eventQueueMaxCount", 2))
	assert_true(LogCore.init())
	LogCore.set_analytics_allowed(true)
	LogCore.track_event("first", [])
	LogCore.track_event("second", [])
	LogCore.track_event("third", [])
	LogCore.set_sender(_probe.send)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() != 1:
		return
	var names: PackedStringArray = PackedStringArray()
	for event: LogAnalyticsEvent in _probe.batches[0].events:
		names.append(event.name)
	assert_eq(names, PackedStringArray(["first", "second"]))
	assert_eq(_probe.batches[0].dropped_event_count, 1)
	assert_eq(_probe.batches[0].dropped_error_count, 0)
