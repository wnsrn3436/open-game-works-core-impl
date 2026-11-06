extends "res://core/qa_core/tests/support/qa_test_case.gd"
## `frame_intervals_ms` of `get_stats`: one interval a frame since the previous `get_stats`, the record size, the real
## time under the test clock, time scale and step mode, the interval of a background return, and the emptying on an
## automation channel connection.

const SERVER := preload("res://core/qa_core/tests/support/qa_loopback_server.gd")
const NATIVE: PackedStringArray = ["android", "ios", "windows", "macos", "linux"]
const TOKEN: String = "qa-frame-interval-token-41c2"
## Real time a process callback waits in one frame, ms.
const WAIT_MS: int = 120
const SMALL_MAX_COUNT: int = 8

var server: SERVER = null


func after_each() -> void:
	if server != null:
		server.stop()
	server = null
	super()


## Waits `ms` of real time in the current frame.
func wait_real(ms: int) -> void:
	var until: int = Time.get_ticks_usec() + ms * 1000
	while Time.get_ticks_usec() < until:
		pass


## The values of `frame_intervals_ms` of `stats`.
func intervals(stats: String) -> PackedFloat64Array:
	var values: PackedFloat64Array = PackedFloat64Array()
	for i: int in JSONR.count(stats, "frame_intervals_ms"):
		values.append(JSONR.number(stats, "frame_intervals_ms.%d" % i))
	return values


func largest(values: PackedFloat64Array) -> float:
	var most: float = 0.0
	for value: float in values:
		most = maxf(most, value)
	return most


## Whether each value of `frame_intervals_ms` of `stats` is written with at most two decimals.
func two_decimals(stats: String) -> bool:
	var array: String = JSONR.at(stats, "frame_intervals_ms")
	for item: String in array.trim_prefix("[").trim_suffix("]").split(",", false):
		var dot: int = item.find(".")
		if item.contains("e") or item.contains("E") or (dot >= 0 and item.length() - dot - 1 > 2):
			return false
	return true


func test_a_get_stats_n_frames_after_the_previous_has_n_intervals_oldest_first() -> void:
	assert_true(await start())
	await UnitTestCore.wait_frames(2)
	await run_ok("get_stats")
	var frames: int = 6
	await UnitTestCore.wait_frames(2)
	wait_real(WAIT_MS)
	await UnitTestCore.wait_frames(frames - 2)
	var stats: String = await run_ok("get_stats")
	var values: PackedFloat64Array = intervals(stats)
	assert_eq(values.size(), frames, "one interval a frame since the previous get_stats")
	assert_true(two_decimals(stats), "at most two decimals: " + JSONR.at(stats, "frame_intervals_ms"))
	assert_true(values.size() == frames and values[2] >= float(WAIT_MS), "the third interval holds the wait: %s" % values)
	assert_true(largest(values) >= float(WAIT_MS))
	assert_eq(intervals(await run_ok("get_stats")).size(), 0, "get_stats emptied the record")
	assert_eq(errors() + warns(), 0)


func test_a_full_record_keeps_the_newest_intervals_without_growing() -> void:
	set_int("QACore.frameIntervalMaxCount", SMALL_MAX_COUNT)
	assert_true(await start())
	await run_ok("get_stats")
	assert_eq(QACore._frame_intervals.size(), SMALL_MAX_COUNT, "init made the record at its size")
	await UnitTestCore.wait_frames(14)
	wait_real(WAIT_MS)
	await UnitTestCore.wait_frames(6)
	assert_eq(QACore._frame_intervals.size(), SMALL_MAX_COUNT, "putting intervals into a full record does not grow it")
	var values: PackedFloat64Array = intervals(await run_ok("get_stats"))
	assert_eq(values.size(), SMALL_MAX_COUNT, "the newest intervals")
	assert_true(values.size() == SMALL_MAX_COUNT and values[2] >= float(WAIT_MS),
		"the 15th of 20 intervals is the third of the 8 newest: %s" % values)


func test_the_intervals_are_real_time_under_the_test_clock_time_scale_and_step_mode() -> void:
	assert_true(await start())
	await run_ok("set_time_scale", PackedStringArray(["100"]))
	await run_ok("set_step_mode", PackedStringArray(["on"]))
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	await UnitTestCore.wait_frames(1)
	await run_ok("get_stats")
	await UnitTestCore.wait_frames(1)
	wait_real(WAIT_MS)
	await UnitTestCore.wait_frames(2)
	var values: PackedFloat64Array = intervals(await run_ok("get_stats"))
	assert_eq(values.size(), 3, "frames are recorded while game time stands")
	assert_true(largest(values) >= float(WAIT_MS), "real time between frames: %s" % values)
	await run_ok("set_step_mode", PackedStringArray(["off"]))


func test_the_interval_that_ends_at_the_first_frame_point_after_a_background_return_is_left_out() -> void:
	assert_true(await start())
	await UnitTestCore.wait_frames(1)
	await run_ok("get_stats")
	await UnitTestCore.wait_frames(2)
	wait_real(WAIT_MS)
	# The test clock goes to the background and back: TimeCore publishes `AppForegroundReturnedEvent` now.
	UnitTestCore.advance_clock(1000, true)
	await UnitTestCore.wait_frames(3)
	var values: PackedFloat64Array = intervals(await run_ok("get_stats"))
	assert_eq(values.size(), 4, "5 frames, the interval of the return left out")
	assert_true(largest(values) < float(WAIT_MS), "the interval with the background time is not in: %s" % values)
	await UnitTestCore.wait_frames(2)
	assert_eq(intervals(await run_ok("get_stats")).size(), 2, "the intervals after it are in")


func test_headless_runs_record_the_frames_that_ran() -> void:
	if not QACore.is_headless():
		pass_test("not a headless run")
		return
	assert_true(await start())
	await UnitTestCore.wait_frames(1)
	await run_ok("get_stats")
	await UnitTestCore.wait_frames(3)
	var values: PackedFloat64Array = intervals(await run_ok("get_stats"))
	assert_eq(values.size(), 3, "one interval a frame that ran")


func test_release_and_init_start_a_new_record() -> void:
	assert_true(await start())
	await UnitTestCore.wait_frames(3)
	QACore.release()
	assert_eq(QACore._frame_intervals.size(), 0, "release deletes the record")
	assert_true(QACore.init())
	await UnitTestCore.wait_frames(3)
	assert_eq(intervals(await run_ok("get_stats")).size(), 2, "the first frame point after init ends no interval")


func test_the_first_get_stats_of_a_connection_holds_only_intervals_after_the_connection() -> void:
	UnitTestCore.require_platform(NATIVE)
	if not CoreBuildInfo.platform in NATIVE:
		return
	server = SERVER.new()
	assert_true(server.start(), "the loopback server listens")
	assert_true(await start())
	await UnitTestCore.wait_frames(1)
	wait_real(WAIT_MS)
	await UnitTestCore.wait_frames(2)
	assert_true(QACore._frame_interval_count >= 2, "intervals before the connection")
	QACore._test_launch_values = {"OGW_AUTOMATION_PORT": str(server.port), "OGW_AUTOMATION_TOKEN": TOKEN}
	QACore._connect_channel()
	assert_true(await pump_until(1), "the hello came")
	assert_true(server.send("{\"id\": 3, \"command\": \"get_stats\", \"args\": []}"))
	assert_true(await pump_until(2))
	var response: String = server.messages[1]
	assert_true(JSONR.boolean(response, "ok"))
	var stats: String = JSONR.at(response, "result")
	assert_true(largest(intervals(stats)) < float(WAIT_MS), "no interval from before the connection: " + stats)


## Polls the server a frame at a time until it has `count` messages.
func pump_until(count: int) -> bool:
	server.poll()
	while server.messages.size() < count:
		if not EventCore.is_initialized():
			return false
		await UnitTestCore.wait_frames(1)
		server.poll()
	return true
