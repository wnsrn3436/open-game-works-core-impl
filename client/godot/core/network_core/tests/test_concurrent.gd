extends "res://core/network_core/tests/support/network_test_case.gd"
## Sends of different handles at the same time: a queue `send` and a `send_auth` do not stop each other, a timeout
## cancels only its own handle, `release` cancels every handle that is sending, and the engine `NetworkTransport`
## keeps two sends apart over real HTTP.

const HTTP_TRANSPORT := preload("res://core/network_core/http_network_transport.gd")
const WEB_TRANSPORT := preload("res://core/network_core/web_network_transport.gd")
const LOGIN: String = "core/Login"
## When the `send_auth` starts after the queue `send` in the timeout test.
const LATER_MS: int = 4000


## A `send_auth` running in the background: `done` and `result` after it ends.
class AuthSent extends RefCounted:
	signal finished
	var done: bool = false
	var result: AuthSendResult = null

	func start() -> void:
		result = await NetworkCore.send_auth(CoreContract.LoginRequest.new(), AuthSendOptions.new())
		done = true
		finished.emit()


## A `NetworkTransport.send` running in the background: `done` and `result` after it ends.
class Sending extends RefCounted:
	signal finished
	var done: bool = false
	var result: NetworkTransportResult = null

	func start(transport: NetworkTransport, handle: int, url: String) -> void:
		result = await transport.send(handle, url, PackedStringArray(["Content-Type: application/x-protobuf"]), "body".to_utf8_buffer())
		done = true
		finished.emit()


func start_auth() -> AuthSent:
	var auth: AuthSent = AuthSent.new()
	auth.start()
	return auth


func wait_auth(auth: AuthSent) -> AuthSendResult:
	if not auth.done:
		await auth.finished
	return auth.result


## Waits a frame at a time for a send over real HTTP. The response ends the wait, not a frame count; a release of the
## modules, as at the test time limit, ends it too. Null when the send did not end.
func wait_sending(sending: Sending) -> NetworkTransportResult:
	while not sending.done and EventCore.is_initialized():
		await UnitTestCore.wait_frames(1)
	return sending.result


## The `NetworkTransport` NetworkCore makes without `set_transport`, with `parent` as its node.
func engine_transport(parent: Node) -> NetworkTransport:
	if OS.get_name() == "Web":
		return WEB_TRANSPORT.new(parent, MAX_BYTES)
	return HTTP_TRANSPORT.new(parent, MAX_BYTES)


func test_queue_send_and_send_auth_do_not_stop_each_other() -> void:
	await start_network()
	UnitTestCore.add_pending(RESYNC)
	UnitTestCore.add_pending(LOGIN)
	var queued: Sent = start_send(request(RESYNC))
	var auth: AuthSent = start_auth()
	await UnitTestCore.wait_frames(2)
	assert_eq([request_count(RESYNC), request_count(LOGIN)], [1, 1], "both sends reach NetworkTransport")
	assert_true(release_ok(LOGIN), "the queue send did not stop the send_auth")
	assert_true((await wait_auth(auth)).ok)
	assert_false(queued.done, "the queue send still waits")
	assert_true(release_ok(RESYNC), "the send_auth did not stop the queue send")
	assert_true(await wait_sent(queued))
	assert_eq(UnitTestCore.cancel_count(), 0, "no cancel")


func test_timeout_cancels_only_the_handle_that_timed_out() -> void:
	await start_network()
	UnitTestCore.add_pending(SILENT)
	# The resend of failure flow 4.
	add_connection_failure(SILENT)
	UnitTestCore.add_pending(LOGIN)
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	var queued: Sent = start_send(request(SILENT), Callable(), on_failure)
	await advance(LATER_MS)
	var auth: AuthSent = start_auth()
	await UnitTestCore.wait_frames(2)
	assert_eq(request_count(LOGIN), 1)
	await advance(TIMEOUT_MS - LATER_MS)
	assert_eq(UnitTestCore.cancel_count(), 1, "the timeout cancels its own handle")
	assert_false(await wait_sent(queued))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.CONNECTION_FAILED]))
	assert_false(auth.done, "the send_auth still waits")
	assert_true(release_ok(LOGIN), "the timeout did not cancel the send_auth")
	assert_true((await wait_auth(auth)).ok)
	assert_eq(UnitTestCore.cancel_count(), 1)
	assert_eq(error_logs(), 1)


func test_release_cancels_every_handle_that_is_sending() -> void:
	await start_network()
	UnitTestCore.add_pending(RESYNC)
	UnitTestCore.add_pending(LOGIN)
	var queued: Sent = start_send(request(RESYNC))
	var auth: AuthSent = start_auth()
	await UnitTestCore.wait_frames(2)
	assert_eq([request_count(RESYNC), request_count(LOGIN)], [1, 1])
	NetworkCore.release()
	assert_eq(UnitTestCore.cancel_count(), 2, "both handles are cancelled")
	assert_false(await wait_sent(queued))
	assert_false((await wait_auth(auth)).ok)
	assert_false(release_ok(RESYNC), "the cancel ended the queue send")
	assert_false(release_ok(LOGIN), "the cancel ended the send_auth")
	assert_eq(completed.size(), 0, "no event")


func test_engine_transport_keeps_two_sends_apart() -> void:
	await start_network()
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty())
	assert_true(await UnitTestCore.add_http_response(base_url, "/a", 200, [], "a".to_utf8_buffer()))
	assert_true(await UnitTestCore.add_http_response(base_url, "/b", 201, [], "b".to_utf8_buffer()))
	var parent: Node = Node.new()
	add_child(parent)
	var transport: NetworkTransport = engine_transport(parent)
	var first: Sending = Sending.new()
	var second: Sending = Sending.new()
	first.start(transport, 1, base_url + "/a")
	second.start(transport, 2, base_url + "/b")
	var a: NetworkTransportResult = await wait_sending(first)
	var b: NetworkTransportResult = await wait_sending(second)
	assert_not_null(a, "the first send ends")
	assert_not_null(b, "the second send ends")
	if a != null:
		assert_eq([a.handle, a.transfer, a.http_status, a.body.get_string_from_utf8()], [1, NetworkCore.TransferResult.DONE, 200, "a"], "the second send did not stop the first")
	if b != null:
		assert_eq([b.handle, b.transfer, b.http_status, b.body.get_string_from_utf8()], [2, NetworkCore.TransferResult.DONE, 201, "b"])
	parent.queue_free()


func test_engine_transport_cancel_stops_only_its_handle() -> void:
	await start_network()
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty())
	assert_true(await UnitTestCore.add_http_response(base_url, "/a", 200, [], "a".to_utf8_buffer()))
	assert_true(await UnitTestCore.add_http_response(base_url, "/b", 200, [], "b".to_utf8_buffer()))
	var parent: Node = Node.new()
	add_child(parent)
	var transport: NetworkTransport = engine_transport(parent)
	var first: Sending = Sending.new()
	var second: Sending = Sending.new()
	first.start(transport, 1, base_url + "/a")
	second.start(transport, 2, base_url + "/b")
	transport.cancel(1)
	var b: NetworkTransportResult = await wait_sending(second)
	assert_not_null(b, "the other send ends")
	if b != null:
		assert_eq([b.handle, b.transfer, b.body.get_string_from_utf8()], [2, NetworkCore.TransferResult.DONE, "b"], "the cancel of another handle did not stop it")
	await UnitTestCore.wait_frames(2)
	# The browser transport gives the cancelled send an empty result; the HTTPRequest of the native one is freed.
	assert_true(first.result == null or first.result.transfer == NetworkCore.TransferResult.CONNECTION_FAILED, "the cancelled send gets no response")
	parent.queue_free()
