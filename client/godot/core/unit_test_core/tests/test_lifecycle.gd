extends "res://core/unit_test_core/tests/support/unit_test_core_test_case.gd"
## UnitTestCore lifecycle: init check, release, init again, and the cleanup when the core node leaves the tree. The
## run of this test is put aside meanwhile.

const Probe := preload("res://core/unit_test_core/tests/support/replacement_probe.gd")


func test_init_release_and_init_again() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var saved: Saved = suspend()
	assert_false(UnitTestCore.is_initialized(), "before init")
	for i: int in 2:
		assert_true(UnitTestCore.init(), "init")
		assert_true(UnitTestCore.is_initialized(), "after init")
		var node: Node = UnitTestCore._node
		assert_true(is_instance_valid(node) and node.is_inside_tree(), "core node in the tree")
		assert_eq(UnitTestCore._test_time_limit_ms, CoreSettings.get_int("UnitTestCore.testTimeLimitMs"))
		assert_eq(UnitTestCore._run_time_limit_ms, CoreSettings.get_int("UnitTestCore.runTimeLimitMs"))
		assert_eq(str(UnitTestCore._settings_types.get("UnitTestCore.testTimeLimitMs", "")), "integer", "the core settings type file")
		assert_false(UnitTestCore.init(), "init while initialized")
		assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "error log of the second init")
		UnitTestCore.release()
		assert_false(UnitTestCore.is_initialized(), "after release")
		assert_initial_state()
		assert_true(is_instance_valid(node) and not node.is_inside_tree(), "core node out of the tree")
	resume(saved)


func test_operations_after_release_give_failure_values() -> void:
	var saved: Saved = suspend()
	assert_true(UnitTestCore.init(), "init")
	UnitTestCore.release()
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 0)
	assert_eq(UnitTestCore.cancel_count(), 0)
	assert_true(UnitTestCore.received_requests().is_empty())
	assert_false(UnitTestCore.release_pending("core/Login", NetworkCore.TransferResult.DONE, 200, PackedByteArray()))
	assert_false(UnitTestCore.set_test_settings("UnitTestCore.testTimeLimitMs", 1))
	assert_false(UnitTestCore.set_invalid_test_settings("UnitTestCore.testTimeLimitMs", "text"))
	assert_eq(UnitTestCore.read_core_fixture("any"), "")
	assert_eq(await UnitTestCore.start_http_server(), "")
	resume(saved)


func test_core_node_leaving_the_tree_cleans_up_like_release() -> void:
	var saved: Saved = suspend()
	assert_true(UnitTestCore.init(), "init")
	var node: Node = UnitTestCore._node
	node.get_parent().remove_child(node)
	assert_false(UnitTestCore.is_initialized(), "after the core node left the tree")
	assert_initial_state()
	await get_tree().process_frame
	assert_false(is_instance_valid(node), "core node freed")
	resume(saved)


## The run of this test is put aside first: a `release` of UnitTestCore takes back only the test replacements of a test
## setup after its own `init`. A module shows its replacement by what it does: `LogCore` gives a failure it reports
## before its `init` to the log collector, `TimeCore` and `LogCore` read the test clock, `NetworkCore` sends through the
## fake network. The server of that `NetworkCore` is a loopback HTTP server of the run of this test: without the fake
## network the request goes to the engine HTTP client, and it goes only to the test host.
func test_release_takes_back_the_replacements_of_the_last_test_setup() -> void:
	var server_url: String = await UnitTestCore.start_http_server()
	assert_ne(server_url, "", "start_http_server")
	if server_url.is_empty():
		return
	var saved: Saved = suspend()
	var outer_clock: DevTestClock = saved.run.clock
	assert_true(UnitTestCore.init(), "init")
	UnitTestCore.release()
	assert_true(UnitTestCore.init(), "init again")
	assert_eq(_collected_failures(), 1, "a release without a test setup leaves the log collector")
	assert_eq(_time_core_device_time(), outer_clock.device_time_ms, "a release without a test setup leaves the test clock")
	UnitTestCore._setup_test()
	var network: UnitTestCore._FAKE_NETWORK = UnitTestCore._run.network
	assert_eq(_collected_failures(), 1, "the test setup gives LogCore the log collector")
	UnitTestCore.release()
	assert_true(UnitTestCore.init(), "init after the release")
	assert_eq(_collected_failures(), 0, "LogCore has no log collector")
	UnitTestCore.release()
	assert_true(_is_device_clock(_time_core_device_time()), "TimeCore has no test clock")
	assert_true(_is_device_clock(_log_core_line_time()), "LogCore has no test clock")
	assert_eq(await _requests_through(network, server_url), 0, "NetworkCore has no fake network")
	assert_initial_state()
	resume(saved)


## Error logs of tag `LogCore` the log collector of this run got for a failure `LogCore` reports before its `init`.
func _collected_failures() -> int:
	var params: Array[LogEventParam] = []
	assert_false(LogCore.track_event("probe", params), "track_event before init")
	return UnitTestCore.check_logs("error", "LogCore")


## Device time `TimeCore` reads between its `init` and `release`. The `release` clears its test clock.
func _time_core_device_time() -> int:
	assert_true(TimeCore.init(), "TimeCore.init")
	var device_time: int = TimeCore.get_device_time()
	TimeCore.release()
	return device_time


## Time of a log line `LogCore` writes between its `init` and `release`. The `release` clears its test clock.
func _log_core_line_time() -> int:
	assert_true(LogCore.init(), "LogCore.init")
	LogCore.log_info("ReplacementProbe", "probe")
	var files: PackedStringArray = LogCoreDev.list_log_files()
	var line: String = ""
	if not files.is_empty():
		var text: String = FileAccess.get_file_as_string(CoreBuildInfo.storage_root.path_join(files[files.size() - 1]))
		var lines: PackedStringArray = text.strip_edges().split("\n")
		line = lines[lines.size() - 1]
	LogCore.release()
	return line.get_slice("\t", 0).to_int()


## Whether `time` is the time of the device clock and not of a test clock.
func _is_device_clock(time: int) -> bool:
	return absi(time - int(Time.get_unix_time_from_system() * 1000.0)) < 60000


## Requests that `network` got from one `send_auth` to `server_url` of a `NetworkCore` initialized now. The `release`
## ends it.
func _requests_through(network: UnitTestCore._FAKE_NETWORK, server_url: String) -> int:
	var before: int = network.received().size()
	assert_true(EventCore.init() and NetworkCore.init(), "EventCore and NetworkCore init")
	assert_true(NetworkCore.set_server_info(server_url, "1.0.0", CoreBuildInfo.platform), "set_server_info")
	var sender: Probe.AuthSender = Probe.AuthSender.new()
	sender.send()
	var count: int = network.received().size() - before
	NetworkCore.release()
	EventCore.release()
	await get_tree().process_frame
	assert_not_null(sender.result, "the release ended the request")
	return count

