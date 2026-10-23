extends "res://core/unit_test_core/tests/support/unit_test_core_test_case.gd"
## Fake network: registered results in order, received requests, holds and cancels.

const URL: String = "http://127.0.0.1/"


## Sends one request through the fake network of the test and keeps its result.
class Sender extends RefCounted:
	var result: NetworkTransportResult = null

	func send(handle: int, request_name: String) -> void:
		result = await UnitTestCore._run.network.send(handle, URL + request_name, PackedStringArray(), PackedByteArray())


func _send(handle: int, request_name: String, headers: PackedStringArray, body: PackedByteArray) -> NetworkTransportResult:
	return await UnitTestCore._run.network.send(handle, URL + request_name, headers, body)


func test_results_come_in_registration_order_and_requests_in_received_order() -> void:
	UnitTestCore.add_result("core/A", NetworkCore.TransferResult.DONE, 200, "first".to_utf8_buffer())
	UnitTestCore.add_result("core/A", NetworkCore.TransferResult.DONE, 500, "second".to_utf8_buffer())
	UnitTestCore.add_result("core/B", NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
	var first: NetworkTransportResult = await _send(1, "core/A", PackedStringArray(["X-One: 1"]), "a".to_utf8_buffer())
	var other: NetworkTransportResult = await _send(2, "core/B", PackedStringArray(), PackedByteArray())
	var second: NetworkTransportResult = await _send(3, "core/A", PackedStringArray(), "c".to_utf8_buffer())
	assert_eq([first.handle, first.transfer, first.http_status, first.body.get_string_from_utf8()], [1, NetworkCore.TransferResult.DONE, 200, "first"])
	assert_eq([other.handle, other.transfer, other.http_status], [2, NetworkCore.TransferResult.CONNECTION_FAILED, 0])
	assert_eq([second.handle, second.transfer, second.http_status, second.body.get_string_from_utf8()], [3, NetworkCore.TransferResult.DONE, 500, "second"])
	var names: PackedStringArray = PackedStringArray()
	for received: UnitTestRequest in UnitTestCore.received_requests():
		names.append(received.name)
	assert_eq(names, PackedStringArray(["core/A", "core/B", "core/A"]))
	var received: Array[UnitTestRequest] = UnitTestCore.received_requests()
	if received.size() == 3:
		assert_eq(received[0].headers, PackedStringArray(["X-One: 1"]))
		assert_eq(received[0].body.get_string_from_utf8(), "a")


func test_request_without_a_result_gets_a_connection_failure_and_fails_the_test() -> void:
	var run: RunState = await run_nested(PackedStringArray(["sample_network.gd"]))
	assert_eq(status_of(run, "test_request_without_result"), "fail")
	assert_string_contains(result_of(run, "test_request_without_result").message, "request core/Missing has no registered result")


func test_held_request_gets_the_result_of_release_pending() -> void:
	UnitTestCore.add_pending("core/Held")
	UnitTestCore.add_pending("core/Held")
	var first: Sender = Sender.new()
	var second: Sender = Sender.new()
	first.send(1, "core/Held")
	second.send(2, "core/Held")
	assert_null(first.result, "no result before release_pending")
	assert_null(second.result, "no result before release_pending")
	assert_true(UnitTestCore.release_pending("core/Held", NetworkCore.TransferResult.DONE, 200, "done".to_utf8_buffer()))
	assert_not_null(first.result, "the request held first gets the result")
	assert_null(second.result, "the request held next waits")
	if first.result != null:
		assert_eq([first.result.handle, first.result.http_status, first.result.body.get_string_from_utf8()], [1, 200, "done"])
	assert_true(UnitTestCore.release_pending("core/Held", NetworkCore.TransferResult.TOO_LARGE, 200, PackedByteArray()))
	if second.result != null:
		assert_eq([second.result.handle, second.result.transfer], [2, NetworkCore.TransferResult.TOO_LARGE])
	assert_false(UnitTestCore.release_pending("core/Held", NetworkCore.TransferResult.DONE, 200, PackedByteArray()), "nothing held")
	assert_eq(UnitTestCore.cancel_count(), 0)


func test_cancel_while_held_counts_one_cancel_and_ends_only_that_handle() -> void:
	UnitTestCore.add_pending("core/Held")
	UnitTestCore.add_pending("core/Held")
	var sender: Sender = Sender.new()
	var other: Sender = Sender.new()
	sender.send(1, "core/Held")
	other.send(2, "core/Held")
	assert_eq(UnitTestCore.cancel_count(), 0)
	UnitTestCore._run.network.cancel(1)
	assert_eq(UnitTestCore.cancel_count(), 1)
	assert_not_null(sender.result, "the held request of the handle ends")
	if sender.result != null:
		assert_eq([sender.result.handle, sender.result.transfer], [1, NetworkCore.TransferResult.CONNECTION_FAILED])
	assert_null(other.result, "the held request of another handle keeps waiting")
	assert_true(UnitTestCore.release_pending("core/Held", NetworkCore.TransferResult.DONE, 200, PackedByteArray()))
	if other.result != null:
		assert_eq([other.result.handle, other.result.transfer], [2, NetworkCore.TransferResult.DONE])
	assert_false(UnitTestCore.release_pending("core/Held", NetworkCore.TransferResult.DONE, 200, PackedByteArray()), "nothing held")


func test_make_response_encodes_the_envelope() -> void:
	var envelope: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	envelope.server_time_at = 1700000000123
	var decoded: CoreContract.ResponseEnvelope = CoreContract.ResponseEnvelope.new()
	assert_true(decoded.decode(UnitTestCore.make_response(envelope)))
	assert_eq(decoded.server_time_at, 1700000000123)


func test_request_name_is_the_path_after_the_host() -> void:
	assert_eq(UnitTestCore._FAKE_NETWORK.request_name_of("http://127.0.0.1/core/cheat/DevLogin"), "core/cheat/DevLogin")
	assert_eq(UnitTestCore._FAKE_NETWORK.request_name_of("http://127.0.0.1:8080/RunCoreTest"), "RunCoreTest")
