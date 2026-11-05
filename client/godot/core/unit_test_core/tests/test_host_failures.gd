extends "res://core/unit_test_core/tests/support/unit_test_core_test_case.gd"
## Failed test host requests: the failure value of the operation and one `UnitTestCore` error log.


## Runs the operations of this test against a loopback HTTP server in place of the test host. It answers 404 to every
## path without a registered response, and records every request it gets.
func test_requests_a_test_host_refuses_give_the_failure_value_and_one_error_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var refusing: String = await UnitTestCore.start_http_server()
	assert_false(refusing.is_empty(), "a base URL")
	var none: Array[PackedStringArray] = []
	assert_true(await UnitTestCore.add_http_response(refusing, "/input", 500, none, '{"error": "no page"}'.to_utf8_buffer()))
	var config: RunConfig = UnitTestCore._run.config
	var test_host: String = config.test_host
	config.test_host = refusing
	assert_eq(await UnitTestCore.start_http_server(), "", "POST /servers")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "POST /servers error log")
	var under_refusing: String = refusing + "/servers/1/files"
	assert_false(await UnitTestCore.add_http_response(under_refusing, "/a.txt", 200, none, PackedByteArray()), "PUT /responses")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "PUT /responses error log")
	assert_true((await UnitTestCore.http_requests(under_refusing)).is_empty(), "GET /requests")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "GET /requests error log")
	var relay: UnitTestWsRelay = await UnitTestCore.open_ws_relay()
	assert_eq([relay.url, relay.control_url], ["", ""], "POST /ws-servers")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "POST /ws-servers error log")
	assert_false(await UnitTestCore.put_page_click(Vector2(2, 2)), "POST /input of a click with 500")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "POST /input of a click error log")
	assert_false(await UnitTestCore.put_page_key("q"), "POST /input of a key with 500")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "POST /input of a key error log")
	config.test_host = test_host
	var paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(refusing):
		paths.append(request.path)
	assert_eq(paths, PackedStringArray([
		"/servers", "/servers/1/responses", "/servers/1/requests", "/ws-servers", "/input", "/input",
	]), "every request went to the refusing host")


## The result file and the release signal sent to a loopback HTTP server in place of the test host, which answers 404
## to both.
func test_result_and_release_signal_a_test_host_refuses_give_false_and_one_error_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	var refusing: String = await UnitTestCore.start_http_server()
	assert_false(refusing.is_empty(), "a base URL")
	var run: RunState = RunState.new()
	run.config.run_id = "refused-result"
	run.config.test_host = refusing
	assert_false(await UnitTestCore._send_result_through(UnitTestCore._node, run), "PUT /result")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "PUT /result error log")
	var config: RunConfig = RunConfig.new()
	config.run_id = "refused-release"
	config.test_host = refusing
	assert_false(await UnitTestCore._send_released(config), "PUT /released")
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "PUT /released error log")
	var paths: PackedStringArray = PackedStringArray()
	for request: UnitTestHttpRequest in await UnitTestCore.http_requests(refusing):
		paths.append(request.path)
	assert_eq(paths, PackedStringArray(["/result", "/released"]), "both requests went to the refusing host")

func test_page_key_with_an_empty_key_is_false_with_an_error_log() -> void:
	assert_true(LogCore.init(), "LogCore.init")
	assert_false(await UnitTestCore.put_page_key(""))
	assert_eq(UnitTestCore.check_logs("error", "UnitTestCore"), 1, "one error log")
