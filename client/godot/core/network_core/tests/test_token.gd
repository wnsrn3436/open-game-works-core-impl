extends "res://core/network_core/tests/support/network_test_case.gd"
## `TOKEN_EXPIRED`, `SESSION_REPLACED` and the failures the `SessionProvider` returns.


func test_token_expired_refreshes_and_sends_again_once() -> void:
	await start_network()
	add_error(RETRY, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	add_ok(RETRY)
	assert_true(await NetworkCore.send(request(RETRY)))
	assert_eq(provider.refresh_calls, 1)
	assert_eq(header(0, "X-Ogw-Request-Id"), header(1, "X-Ogw-Request-Id"))
	# A second TOKEN_EXPIRED goes on from step 2 without a refresh.
	add_error(RETRY, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	add_error(RETRY, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	var codes: PackedInt32Array = PackedInt32Array()
	var on_failure: Callable = func(failure: RequestFailure) -> bool:
		codes.append(failure.error_code)
		return true
	assert_false(await NetworkCore.send(request(RETRY), Callable(), on_failure))
	assert_eq(provider.refresh_calls, 2)
	assert_eq(codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED]))
	assert_eq(request_count(RETRY), 4)
	assert_eq(warn_logs(), 1)


func test_token_resend_does_not_count_as_a_retry() -> void:
	await start_network()
	add_error(RETRY, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	for i: int in RETRY_COUNT:
		assert_true(popup_shows(ReservedString.network_retry()), "retry popup %d" % i)
		add_connection_failure(RETRY)
		assert_true(await press_popup_button(ReservedString.network_retry()))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_go_to_title()), "exhausted after retryCount popup retries")
	assert_false(await wait_sent(sent))
	assert_eq(request_count(RETRY), 3 + RETRY_COUNT)
	assert_eq(error_logs(), 1)


func test_maintenance_from_the_refresh_ends_without_send_again() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	provider.refresh_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	assert_false(await NetworkCore.send(request(INTERACTION)))
	assert_eq(request_count(), 1, "not sent again")
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_maintenance()))
	assert_true(popup_shows(ReservedString.network_go_to_title()))


func test_refresh_failure_without_server_error_sends_again_as_connection_failed() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	provider.refresh_results.append(FakeProvider.failed(0))
	add_ok(INTERACTION)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_eq(request_count(), 2, "step 4 sends again")


func test_session_replaced_from_the_refresh_ends_silently() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	provider.refresh_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED))
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
	assert_eq(provider.replaced_calls, 0)
	assert_eq(calls[0], 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)


func test_session_end_during_the_refresh_drops_the_request() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	provider.hold_refresh = true
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	var sent: Sent = start_send(request(INTERACTION), Callable(), on_failure)
	await UnitTestCore.wait_frames(1)
	NetworkCore.set_session_provider(null)
	provider.release_refresh()
	assert_false(await wait_sent(sent))
	assert_eq(request_count(), 1, "not sent again")
	assert_eq(calls[0], 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	assert_eq(completed, PackedStringArray([INTERACTION + ":false"]))


func test_maintenance_from_the_provider_leaves_no_network_log() -> void:
	await start_network()
	provider.get_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	assert_false(await NetworkCore.send(request(INTERACTION)))
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	provider.refresh_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_MAINTENANCE))
	assert_false(await NetworkCore.send(request(INTERACTION)))
	assert_eq(warn_logs(), 0)


func test_session_replaced_from_the_token_ends_silently() -> void:
	await start_network()
	provider.get_results.append(FakeProvider.failed(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED))
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
	assert_eq(calls[0], 0)
	assert_eq(request_count(), 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)


func test_session_replaced_response_notifies_the_provider_once() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
	assert_eq(provider.replaced_calls, 1)
	assert_eq(calls[0], 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	assert_eq(warn_logs(), 1)


func test_notify_server_error() -> void:
	await start_network()
	NetworkCore.notify_server_error(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	assert_eq(provider.replaced_calls, 1)
	NetworkCore.notify_server_error(CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED)
	NetworkCore.notify_server_error(CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED)
	assert_eq(update_codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED]))
	NetworkCore.notify_server_error(CoreContract.CoreError.CORE_ERROR_BANNED)
	assert_eq(provider.replaced_calls, 1)
	assert_eq(update_codes.size(), 2)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	assert_eq(restart_count, 0)
	assert_eq(warn_logs(), 0)
