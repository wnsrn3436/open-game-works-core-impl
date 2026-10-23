extends UnitTestCase
## `track_event`: input checks and the analytics allowed state.

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


static func _int(param_name: String, value: int) -> LogEventParam:
	var param: LogEventParam = LogEventParam.new()
	param.name = param_name
	param.value_type = LogEventParam.ValueType.INT
	param.int_value = value
	return param


static func _float(param_name: String, value: float) -> LogEventParam:
	var param: LogEventParam = LogEventParam.new()
	param.name = param_name
	param.value_type = LogEventParam.ValueType.FLOAT
	param.float_value = value
	return param


static func _string(param_name: String, value: String) -> LogEventParam:
	var param: LogEventParam = LogEventParam.new()
	param.name = param_name
	param.value_type = LogEventParam.ValueType.STRING
	param.string_value = value
	return param


static func _bool(param_name: String, value: bool) -> LogEventParam:
	var param: LogEventParam = LogEventParam.new()
	param.name = param_name
	param.value_type = LogEventParam.ValueType.BOOL
	param.bool_value = value
	return param


static func _event_names(batch: LogBatch) -> PackedStringArray:
	var out: PackedStringArray = PackedStringArray()
	for event: LogAnalyticsEvent in batch.events:
		out.append(event.name)
	return out


func test_track_event_rejects_invalid_input_with_one_error_per_name() -> void:
	assert_true(LogCore.init())
	LogCore.set_analytics_allowed(true)
	LogCore.set_sender(_probe.send)
	var too_many: Array[LogEventParam] = []
	for i: int in LogCore._event_param_max_count + 1:
		too_many.append(_int("p%d" % i, i))
	var long_param: String = "p" + "a".repeat(LogCore._event_param_name_max_length)
	var none: Array[LogEventParam] = []
	var duplicate: Array[LogEventParam] = [_int("same", 1), _int("same", 2)]
	var long_name: Array[LogEventParam] = [_int(long_param, 1)]
	var bad_name: Array[LogEventParam] = [_int("Bad", 1)]
	var long_string: Array[LogEventParam] = [_string("text", "s".repeat(LogCore._event_string_max_length + 1))]
	var nan_value: Array[LogEventParam] = [_float("value", NAN)]
	var infinite_value: Array[LogEventParam] = [_float("value", INF)]
	for round: int in 2:
		assert_false(LogCore.track_event("NotSnake", none))
		assert_false(LogCore.track_event("core_started", none))
		assert_false(LogCore.track_event("a".repeat(LogCore._event_name_max_length + 1), none))
		assert_false(LogCore.track_event("duplicate_names", duplicate))
		assert_false(LogCore.track_event("long_param_name", long_name))
		assert_false(LogCore.track_event("bad_param_name", bad_name))
		assert_false(LogCore.track_event("too_many_params", too_many))
		assert_false(LogCore.track_event("long_string", long_string))
		assert_false(LogCore.track_event("nan_value", nan_value))
		assert_false(LogCore.track_event("infinite_value", infinite_value))
		assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 10, "round %d" % round)
	var valid: Array[LogEventParam] = [_int("stage_id", 3), _float("elapsed", 1.5), _string("mode", "hard"), _bool("first", true)]
	assert_true(LogCore.track_event("stage_clear", valid))
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() != 1:
		return
	assert_eq(_event_names(_probe.batches[0]), PackedStringArray(["stage_clear"]))
	if _probe.batches[0].events.size() != 1:
		return
	var event: LogAnalyticsEvent = _probe.batches[0].events[0]
	assert_eq(event.time, _probe.clock.device_time_ms)
	assert_eq(event.params.size(), 4)
	if event.params.size() == 4:
		assert_eq(event.params[0].int_value, 3)
		assert_eq(event.params[1].float_value, 1.5)
		assert_eq(event.params[2].string_value, "hard")
		assert_true(event.params[3].bool_value)


func test_events_need_the_analytics_allowed_state_and_errors_do_not() -> void:
	assert_true(LogCore.init())
	LogCore.set_sender(_probe.send)
	assert_false(LogCore.track_event("before_allowed", []))
	LogCore.set_analytics_allowed(true)
	assert_true(LogCore.track_event("queued_then_cleared", []))
	LogCore.set_analytics_allowed(false)
	assert_false(LogCore.track_event("after_disallowed", []))
	assert_eq(_probe.count(LogCore.Level.ERROR, "LogCore"), 0)
	LogCore.log_error("test", "sent anyway")
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1:
		assert_eq(_probe.batches[0].events.size(), 0)
		assert_eq(_probe.batches[0].dropped_event_count, 0)
		assert_eq(_probe.batches[0].errors.size(), 1)
	LogCore.set_analytics_allowed(true)
	assert_true(LogCore.track_event("allowed_again", []))
	_probe.advance(LogCore._send_interval_ms)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 2)
	if _probe.batches.size() == 2:
		assert_eq(_event_names(_probe.batches[1]), PackedStringArray(["allowed_again"]))


func test_disallowing_analytics_clears_the_dropped_event_count() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.eventQueueMaxCount", 2))
	assert_true(LogCore.init())
	LogCore.set_analytics_allowed(true)
	for i: int in 3:
		LogCore.track_event("overflow", [])
	assert_eq(LogCore._dropped_events, 1)
	LogCore.set_analytics_allowed(false)
	LogCore.set_analytics_allowed(true)
	assert_true(LogCore.track_event("after_the_reset", []))
	LogCore.set_sender(_probe.send)
	await UnitTestCore.wait_frames(2)
	assert_eq(_probe.batches.size(), 1)
	if _probe.batches.size() == 1:
		assert_eq(_event_names(_probe.batches[0]), PackedStringArray(["after_the_reset"]))
		assert_eq(_probe.batches[0].dropped_event_count, 0)
