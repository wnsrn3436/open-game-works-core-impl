extends "res://core/network_core/tests/support/network_test_case.gd"
## Response processing: time sync, delta apply, callbacks and the failures of a response.


func _on_user_state_changed(_event: UserStateChangedEvent) -> void:
	marks.append("delta")


func test_success_runs_sync_delta_callback_event_in_order() -> void:
	await start_network()
	assert_true(EventCore.subscribe(UserStateChangedEvent, _on_user_state_changed))
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array([7]))
	add_envelope(INTERACTION, env)
	var on_success: Callable = func(_response: ContractMessage) -> void:
		marks.append("synced" if TimeCore.is_synced() else "not synced")
		marks.append("callback")
	assert_true(await NetworkCore.send(request(INTERACTION), on_success))
	assert_eq(marks, PackedStringArray(["delta", "synced", "callback", "completed"]))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 1)


func test_refused_delta_ends_as_invalid_response_without_anything_else() -> void:
	await start_network()
	var calls: PackedStringArray = PackedStringArray()
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array(), false, true)
	env.pending_user_state = tutorial_delta(PackedInt64Array([9]))
	var change: CoreContract.ItemChange = CoreContract.ItemChange.new()
	change.item_id = 1
	change.delta = 1
	env.item_changes.append(change)
	add_envelope(RETRY, env)
	var on_success: Callable = func(_response: ContractMessage) -> void:
		calls.append("success")
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		calls.append("failure")
		return false
	assert_false(await NetworkCore.send(request(RETRY), on_success, on_failure))
	assert_eq(calls.size(), 0, "no callback")
	assert_eq(request_count(), 1, "no send again")
	assert_eq(popup_count(), 0, "no popup")
	assert_eq(completed, PackedStringArray([RETRY + ":false"]))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 0, "the pending delta is not applied")
	assert_eq(UnitTestCore.check_logs("error", "UserStateCore"), 1)
	# send_auth gives an InvalidResponse result.
	add_envelope("core/Login", env)
	var result: AuthSendResult = await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())
	assert_false(result.ok)
	assert_eq(result.failure.kind, NetworkCore.FailureKind.INVALID_RESPONSE)
	assert_eq(UnitTestCore.check_logs("error", "UserStateCore"), 1)


func test_time_sync_with_a_session_provider() -> void:
	await start_network()
	for request_name: String in ["core/Login", "core/GetTerms", "core/GetNotices"]:
		add_ok(request_name)
		var result: AuthSendResult = await NetworkCore.send_auth(request(request_name), AuthSendOptions.new())
		assert_true(result.ok)
	assert_false(TimeCore.is_synced(), "Login, GetTerms and GetNotices do not sync while a provider is set")
	for code: int in [CoreContract.CoreError.CORE_ERROR_MAINTENANCE, CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED, GameContract.GameError.GAME_ERROR_CORE_TEST]:
		add_error(SILENT, code)
		assert_false(await NetworkCore.send(request(SILENT)))
	add_error(SILENT, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	add_error(SILENT, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	assert_false(await NetworkCore.send(request(SILENT)))
	assert_false(TimeCore.is_synced(), "error responses do not sync while a provider is set")
	assert_eq(error_logs(), 4)


func test_time_sync_without_a_session_provider() -> void:
	await start_network(false)
	add_error("core/Login", CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	var failed: AuthSendResult = await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())
	assert_false(failed.ok)
	assert_true(TimeCore.is_synced(), "an error response syncs without a provider")
	assert_eq(warn_logs(), 1)
	for request_name: String in ["core/AutoLogin", "core/GetTerms", "core/GetNotices", "core/Login"]:
		add_ok(request_name, SERVER_TIME + 1000)
		var before: int = TimeCore.get_server_time()
		var result: AuthSendResult = await NetworkCore.send_auth(request(request_name), AuthSendOptions.new())
		assert_true(result.ok)
		assert_eq(TimeCore.get_server_time() - before, 1000, "%s syncs without a provider" % request_name)
		add_error(request_name, GameContract.GameError.GAME_ERROR_CORE_TEST)
		result = await NetworkCore.send_auth(request(request_name), AuthSendOptions.new())
		assert_false(result.ok)
		assert_eq(TimeCore.get_server_time() - before, 0, "the %s error response syncs" % request_name)
		assert_eq(warn_logs(), 1)


func test_first_signed_request_after_login_uses_the_synced_time() -> void:
	await start_network(false)
	assert_false(TimeCore.is_synced())
	add_ok("core/Login", SERVER_TIME + 60000)
	var login: AuthSendResult = await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())
	assert_true(login.ok)
	provider = FakeProvider.new()
	NetworkCore.set_session_provider(provider)
	add_ok(INTERACTION)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_eq(header(1, "X-Ogw-Timestamp"), str(SERVER_TIME + 60000))
	assert_ne(header(1, "X-Ogw-Timestamp"), str(TimeCore.get_device_time()))


func test_error_and_invalid_responses_do_not_apply_deltas() -> void:
	await start_network()
	var env: CoreContract.ResponseEnvelope = envelope()
	env.error = CoreContract.ServerError.new()
	env.error.code = GameContract.GameError.GAME_ERROR_CORE_TEST
	env.user_state = tutorial_delta(PackedInt64Array([1]))
	add_envelope(SILENT, env)
	assert_false(await NetworkCore.send(request(SILENT)))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 0)
	# Body that does not decode, and error code 0 and below: InvalidResponse.
	var bad: CoreContract.ResponseEnvelope = envelope()
	bad.body = PackedByteArray([0xFF, 0xFF, 0xFF])
	bad.user_state = tutorial_delta(PackedInt64Array([2]))
	add_envelope(SILENT, bad)
	add_envelope(SILENT, bad)
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	var zero: CoreContract.ResponseEnvelope = envelope()
	zero.error = CoreContract.ServerError.new()
	zero.error.code = -3
	add_envelope(SILENT, zero)
	add_envelope(SILENT, zero)
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.INVALID_RESPONSE, NetworkCore.FailureKind.INVALID_RESPONSE]))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 0)
	assert_eq(error_logs(), 3)


func test_codes_outside_this_build_are_server_errors_shown_by_the_hook() -> void:
	await start_network()
	assert_true(NetworkCore.register_error_display(_ErrorDisplayHook.display))
	for code: int in [999, 5000]:
		_ErrorDisplayHook.calls = PackedStringArray()
		add_error(RETRY, code)
		var kinds: PackedInt32Array = PackedInt32Array()
		var on_failure: Callable = func(failure: RequestFailure) -> bool:
			kinds.append(failure.kind)
			return false
		assert_false(await NetworkCore.send(request(RETRY), Callable(), on_failure))
		assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.SERVER_ERROR]))
		assert_eq(request_count(RETRY), 1 if code == 999 else 2, "a Retry request is not sent again")
		assert_eq(_ErrorDisplayHook.calls, PackedStringArray(["%d:%s" % [code, RETRY]]))
		await UnitTestCore.wait_frames(2)
		assert_true(popup_shows(ReservedString.network_error_general()), "the hook's popup")
		assert_false(popup_shows(ReservedString.network_retry()), "no retry popup")
		assert_eq(error_logs(), 1)
		UICore.close_all_popups()
		await UnitTestCore.wait_frames(2)


func test_late_result_after_timeout_is_dropped() -> void:
	await start_network()
	UnitTestCore.add_pending(SILENT)
	UnitTestCore.add_pending(SILENT)
	var calls: PackedStringArray = PackedStringArray()
	var on_success: Callable = func(_response: ContractMessage) -> void:
		calls.append("success")
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		calls.append("failure %d" % failure.kind)
		return true
	var sent: Sent = start_send(request(SILENT), on_success, on_failure)
	await advance(TIMEOUT_MS)
	assert_eq(UnitTestCore.cancel_count(), 1, "the timeout cancels the transport")
	await advance(TIMEOUT_MS)
	assert_false(await wait_sent(sent))
	assert_eq(calls, PackedStringArray(["failure %d" % NetworkCore.FailureKind.TIMEOUT]))
	release_ok(SILENT)
	release_ok(SILENT)
	await UnitTestCore.wait_frames(2)
	assert_eq(calls.size(), 1, "the late result is not processed")
	assert_false(TimeCore.is_synced())
	assert_eq(error_logs(), 1)


func test_http_500_redirect_and_size_limit_are_invalid_responses() -> void:
	await start_network()
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	var too_big: PackedByteArray = PackedByteArray()
	too_big.resize(MAX_BYTES + 1)
	var cases: Array[PackedByteArray] = [PackedByteArray(), PackedByteArray(), too_big]
	var transfers: Array[NetworkCore.TransferResult] = [NetworkCore.TransferResult.DONE, NetworkCore.TransferResult.REDIRECTED, NetworkCore.TransferResult.TOO_LARGE]
	var statuses: PackedInt32Array = PackedInt32Array([500, 302, 200])
	for i: int in 3:
		UnitTestCore.add_result(SILENT, transfers[i], statuses[i], cases[i])
		UnitTestCore.add_result(SILENT, transfers[i], statuses[i], cases[i])
		assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	# A body over the limit through a transport that does not stop at it.
	UnitTestCore.add_result(SILENT, NetworkCore.TransferResult.DONE, 200, too_big)
	UnitTestCore.add_result(SILENT, NetworkCore.TransferResult.DONE, 200, too_big)
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	var invalid: int = NetworkCore.FailureKind.INVALID_RESPONSE
	assert_eq(kinds, PackedInt32Array([invalid, invalid, invalid, invalid]))
	assert_eq(error_logs(), 4)


func test_redirect_and_size_limit_over_real_http() -> void:
	await start_network()
	var base_url: String = await UnitTestCore.start_http_server()
	assert_false(base_url.is_empty())
	NetworkCore.release()
	NetworkCoreDev.set_transport(null)
	assert_true(NetworkCore.init())
	assert_true(NetworkCore.set_server_info(base_url, APP_VERSION, CoreBuildInfo.platform))
	NetworkCore.set_session_provider(provider)
	# Keeps LogCore's batches of the failure logs off the server, as `start_network` does.
	LogCore.clear_sender()
	var kinds: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		kinds.append(failure.kind)
		return true
	var big: PackedByteArray = PackedByteArray()
	big.resize(MAX_BYTES + 1)
	assert_true(await UnitTestCore.add_http_response(base_url, "/" + SILENT, 302, [PackedStringArray(["Location", base_url + "/elsewhere"])], PackedByteArray()))
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_true(await UnitTestCore.add_http_response(base_url, "/" + SILENT, 200, [], big))
	assert_false(await NetworkCore.send(request(SILENT), Callable(), on_failure))
	assert_eq(kinds, PackedInt32Array([NetworkCore.FailureKind.INVALID_RESPONSE, NetworkCore.FailureKind.INVALID_RESPONSE]))
	var paths: PackedStringArray = PackedStringArray()
	for received in await UnitTestCore.http_requests(base_url):
		paths.append(received.path)
	assert_false(paths.has("/elsewhere"), "the redirect is not followed")
	assert_eq(error_logs(), 2)
	# A response in the limit goes through the same transport.
	var successes: Array[int] = [0]
	var on_success: Callable = func(_response: ContractMessage) -> void:
		successes[0] += 1
	assert_true(await UnitTestCore.add_http_response(base_url, "/" + SILENT, 200, [], ok_bytes()))
	assert_true(await NetworkCore.send(request(SILENT), on_success, on_failure))
	assert_eq(successes[0], 1)
	assert_eq(kinds.size(), 2)
	var received: Array[UnitTestHttpRequest] = await UnitTestCore.http_requests(base_url)
	assert_false(received.is_empty())
	if not received.is_empty():
		var content_type: String = ""
		for pair: PackedStringArray in received[received.size() - 1].headers:
			if pair.size() == 2 and pair[0].to_lower() == "content-type":
				content_type = pair[1]
		assert_eq(content_type, "application/x-protobuf")


## The `error_display` hook of the tests: records its calls and shows a general popup.
class _ErrorDisplayHook extends RefCounted:
	static var calls: PackedStringArray = PackedStringArray()

	static func display(code: int, request_name: String) -> ErrorDisplay:
		calls.append("%d:%s" % [code, request_name])
		var out: ErrorDisplay = ErrorDisplay.new()
		out.kind = NetworkCore.ErrorDisplayKind.POPUP
		out.translation_key = ReservedString.network_error_general()
		return out
