extends "res://core/network_core/tests/support/network_test_case.gd"
## Failure flow and default handling.


func _handled(_failure: RequestFailure) -> bool:
	return true


func test_retry_after_max_retry_age_gives_the_exhausted_popup() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_retry()))
	await advance(MAX_RETRY_AGE_MS)
	assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(), 2, "not passed to NetworkTransport")
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_go_to_title()))
	assert_eq(error_logs(), 1)


func test_device_time_alone_reaching_max_retry_age_counts() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	UnitTestCore.set_device_time(TimeCore.get_device_time() + MAX_RETRY_AGE_MS)
	assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(), 2)
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_go_to_title()))
	assert_eq(error_logs(), 1)


func test_update_errors_publish_once_without_callback_or_popup() -> void:
	await start_network()
	for code: int in [CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED]:
		add_error(INTERACTION, code)
		var calls: Array[int] = [0]
		var on_failure: Callable = func(_failure: RequestFailure) -> bool:
			calls[0] += 1
			return false
		assert_false(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
		assert_eq(calls[0], 0)
	assert_eq(update_codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED]))
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	assert_eq(error_logs(), 2)


func test_handled_failure_shows_nothing() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_RATE_LIMITED)
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), _handled))
	add_connection_failure(RETRY, 2)
	assert_false(await NetworkCore.send(request(RETRY), Callable(), _handled))
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	assert_false(toast_shows(ReservedString.network_error_rate_limited()))
	assert_eq(warn_logs(), 1, "a handled ServerError is one warn")
	assert_eq(error_logs(), 1, "a communication failure is one error")


func test_log_levels_of_server_errors() -> void:
	await start_network()
	add_error(SILENT, GameContract.GameError.GAME_ERROR_CORE_TEST)
	assert_false(await NetworkCore.send(request(SILENT)))
	assert_eq(error_logs(), 1, "an unhandled ServerError is one error")
	add_error("core/Login", GameContract.GameError.GAME_ERROR_CORE_TEST)
	assert_false((await NetworkCore.send_auth(request("core/Login"), AuthSendOptions.new())).ok)
	assert_eq(warn_logs(), 1, "a send_auth ServerError is one warn")


func test_communication_failure_sends_again_once_without_screen() -> void:
	await start_network()
	add_connection_failure(INTERACTION)
	add_ok(INTERACTION)
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	assert_true(await NetworkCore.send(request(INTERACTION), Callable(), on_failure))
	assert_eq(calls[0], 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	# That send again is not a retry: a Retry request still gets retryCount popup retries after it.
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	for i: int in RETRY_COUNT:
		await UnitTestCore.wait_frames(2)
		assert_true(popup_shows(ReservedString.network_retry()))
		add_connection_failure(RETRY)
		assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(RETRY), 2 + RETRY_COUNT)
	assert_eq(restart_count, 0)
	assert_true(await press_popup_button(ReservedString.network_go_to_title()))
	assert_eq(restart_count, 1, "title publishes RestartRequestedEvent once")
	assert_eq(error_logs(), 1)


func test_default_handling_by_kind_and_failure() -> void:
	await start_network()
	# Interaction: error popup with confirm for a communication failure.
	add_connection_failure(INTERACTION, 2)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_connection()))
	assert_true(popup_shows(ReservedString.network_confirm()))
	assert_true(await press_popup_button(ReservedString.network_confirm()))
	assert_eq(popup_count(), 0, "confirm only closes")
	# Interaction and Retry: ErrorDisplay for a ServerError.
	for request_name: String in [INTERACTION, RETRY]:
		add_error(request_name, CoreContract.CoreError.CORE_ERROR_BANNED)
		assert_false(await NetworkCore.send(request(request_name)))
		await UnitTestCore.wait_frames(2)
		assert_true(popup_shows(ReservedString.network_error_banned()))
		UICore.close_all_popups()
		await UnitTestCore.wait_frames(2)
	# Silent and SilentRetry: nothing but the callback and the log.
	for request_name: String in [SILENT, SILENT_RETRY]:
		var calls: Array[int] = [0]
		var on_failure: Callable = func(_failure: RequestFailure) -> bool:
			calls[0] += 1
			return false
		add_error(request_name, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
		assert_false(await NetworkCore.send(request(request_name), Callable(), on_failure))
		assert_eq(calls[0], 1)
		await UnitTestCore.wait_frames(2)
		assert_eq(popup_count(), 0)
		assert_false(toast_shows(ReservedString.network_error_maintenance()))
	assert_eq(error_logs(), 5)


func test_timeout_and_invalid_response_popups() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	await advance(TIMEOUT_MS)
	await advance(TIMEOUT_MS)
	assert_false(await wait_sent(sent))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_timeout()))
	UICore.close_all_popups()
	UnitTestCore.add_result(INTERACTION, NetworkCore.TransferResult.DONE, 500, PackedByteArray())
	UnitTestCore.add_result(INTERACTION, NetworkCore.TransferResult.DONE, 500, PackedByteArray())
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_invalid_response()))
	assert_eq(error_logs(), 2)


func test_retry_exhausted_and_silent_retry_send_again_retry_count_times() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	for i: int in RETRY_COUNT:
		await UnitTestCore.wait_frames(2)
		add_connection_failure(RETRY)
		assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_go_to_title()))
	assert_true(await press_popup_button(ReservedString.network_go_to_title()))
	assert_eq(restart_count, 1)
	# SilentRetry: retryCount sends again after the step 4 send again, without screen.
	add_connection_failure(SILENT_RETRY, 2 + RETRY_COUNT)
	var silent: Sent = start_send(request(SILENT_RETRY))
	for i: int in RETRY_COUNT:
		await advance(RETRY_DELAY_MAX_MS)
	assert_false(await wait_sent(silent))
	assert_eq(request_count(SILENT_RETRY), 2 + RETRY_COUNT)
	assert_eq(popup_count(), 0)
	assert_eq(error_logs(), 2)


func test_silent_retry_calls_the_failure_callback_once_at_the_end() -> void:
	await start_network()
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return true
	add_connection_failure(SILENT_RETRY, 2 + RETRY_COUNT)
	var sent: Sent = start_send(request(SILENT_RETRY), Callable(), on_failure)
	for i: int in RETRY_COUNT:
		assert_eq(calls[0], 0, "no callback while sends again are left")
		await advance(RETRY_DELAY_MAX_MS)
	assert_false(await wait_sent(sent))
	assert_eq(calls[0], 1)
	add_error(SILENT_RETRY, CoreContract.CoreError.CORE_ERROR_RATE_LIMITED)
	assert_false(await NetworkCore.send(request(SILENT_RETRY), Callable(), on_failure))
	assert_eq(calls[0], 2, "a ServerError is not sent again")
	assert_eq(request_count(SILENT_RETRY), 3 + RETRY_COUNT)
	assert_eq(error_logs(), 1)
	assert_eq(warn_logs(), 1)


func test_retry_delays_grow_and_stop_at_the_max() -> void:
	await start_network()
	add_connection_failure(SILENT_RETRY, 2 + RETRY_COUNT)
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(SILENT_RETRY), Callable(), _handled)
	var next: Sent = start_send(request(INTERACTION))
	assert_eq(request_count(SILENT_RETRY), 2, "the first send and the step 4 send again")
	var delays: PackedInt32Array = PackedInt32Array([RETRY_DELAY_MS, RETRY_DELAY_MS * 2, RETRY_DELAY_MAX_MS])
	for i: int in delays.size():
		await advance(delays[i] - 1)
		assert_eq(request_count(SILENT_RETRY), 2 + i, "no NetworkTransport call during the delay")
		assert_eq(request_count(INTERACTION), 0, "the next request waits")
		await advance(1)
		assert_eq(request_count(SILENT_RETRY), 3 + i)
	assert_false(await wait_sent(sent))
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(next))
	assert_eq(error_logs(), 1)


func test_send_auth_retry_delays() -> void:
	await start_network()
	add_connection_failure("core/Logout", 1 + RETRY_COUNT)
	var done: Array[AuthSendResult] = []
	var run: Callable = func() -> void:
		done.append(await NetworkCore.send_auth(CoreContract.LogoutRequest.new(), AuthSendOptions.new()))
	run.call()
	assert_eq(request_count("core/Logout"), 1)
	await advance(RETRY_DELAY_MS - 1)
	assert_eq(request_count("core/Logout"), 1)
	await advance(1)
	assert_eq(request_count("core/Logout"), 2)
	await advance(RETRY_DELAY_MS * 2)
	await advance(RETRY_DELAY_MAX_MS)
	assert_eq(request_count("core/Logout"), 1 + RETRY_COUNT)
	assert_eq(done.size(), 1)
	assert_false(done[0].ok)
	assert_eq(error_logs(), 1)


func test_retry_popup_retry_has_no_delay() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	add_ok(RETRY)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_eq(request_count(RETRY), 3, "sent at once")
	assert_true(await wait_sent(sent))


func test_retry_popup_closed_without_retry_fails_and_starts_the_next() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	add_ok(INTERACTION)
	var sent: Sent = start_send(request(RETRY))
	var next: Sent = start_send(request(INTERACTION))
	await UnitTestCore.wait_frames(2)
	assert_eq(request_count(INTERACTION), 0)
	UICore.close_all_popups()
	assert_false(await wait_sent(sent))
	assert_true(await wait_sent(next))
	assert_eq(error_logs(), 1)


func test_back_input_does_not_close_title_popups() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	await press_back()
	assert_true(popup_shows(ReservedString.network_go_to_title()), "PopupRestart stays")
	UICore.close_all_popups()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	await press_back()
	assert_true(popup_shows(ReservedString.network_retry()), "retry popup stays")
	UICore.close_all_popups()
	assert_false(await wait_sent(sent))
	assert_eq(error_logs(), 2)


func test_codes_outside_the_table_use_the_hook() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_general()), "without a hook: Popup, [network_error_general]")
	UICore.close_all_popups()
	_Hook.calls = 0
	assert_true(NetworkCore.register_error_display(_Hook.display))
	for code: int in [CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN, GameContract.GameError.GAME_ERROR_CORE_TEST, 4321]:
		add_error(INTERACTION, code)
		assert_false(await NetworkCore.send(request(INTERACTION)))
		await UnitTestCore.wait_frames(2)
		assert_true(toast_shows(ReservedString.network_error_rate_limited()), "the hook's toast for %d" % code)
	assert_eq(_Hook.calls, 3)
	for code: int in [CoreContract.CoreError.CORE_ERROR_UNAUTHORIZED, CoreContract.CoreError.CORE_ERROR_RATE_LIMITED]:
		add_error(INTERACTION, code)
		assert_false(await NetworkCore.send(request(INTERACTION)))
	assert_eq(_Hook.calls, 3, "no hook call for a code in the table")
	assert_eq(error_logs(), 6)


func test_feature_disabled_is_one_toast() -> void:
	await start_network()
	assert_true(NetworkCore.register_error_display(_Hook.display))
	_Hook.calls = 0
	for request_name: String in [INTERACTION, RETRY]:
		add_error(request_name, CoreContract.CoreError.CORE_ERROR_FEATURE_DISABLED)
		assert_false(await NetworkCore.send(request(request_name)))
		assert_eq(request_count(request_name), 1, "not sent again")
		await UnitTestCore.wait_frames(2)
		assert_true(toast_shows(ReservedString.network_error_feature_disabled()))
		assert_eq(popup_count(), 0)
		MessageCore.close_all()
		await UnitTestCore.wait_frames(2)
	assert_eq(_Hook.calls, 0)
	assert_eq(error_logs(), 2)


func test_diagnostic_text_by_build() -> void:
	await start_network()
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	var text: String = popup_text_with("CORE_ERROR_NICKNAME_TAKEN")
	assert_false(text.is_empty(), "DEV build: error name")
	for part: String in [str(CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN), INTERACTION, "200", "detail of %d" % CoreContract.CoreError.CORE_ERROR_NICKNAME_TAKEN]:
		assert_true(text.contains(part), part)
	UICore.close_all_popups()
	CoreBuildInfo.has_dev_code = false
	add_error(INTERACTION, CoreContract.CoreError.CORE_ERROR_RATE_LIMITED)
	assert_false(await NetworkCore.send(request(INTERACTION)))
	await UnitTestCore.wait_frames(2)
	var shown: String = ""
	for line: String in layer_texts(UICore.UILayer.MESSAGE):
		if line.contains("(%d)" % CoreContract.CoreError.CORE_ERROR_RATE_LIMITED):
			shown = line
	assert_false(shown.is_empty(), "STG and PROD: the error code")
	assert_false(shown.contains("CORE_ERROR_RATE_LIMITED"))
	assert_false(shown.contains(INTERACTION))
	assert_eq(error_logs(), 2)


func test_completed_event_once_per_request_and_destroyed_callbacks() -> void:
	await start_network()
	add_ok(SILENT)
	add_error(SILENT, GameContract.GameError.GAME_ERROR_CORE_TEST)
	assert_true(await NetworkCore.send(request(SILENT)))
	assert_false(await NetworkCore.send(request(SILENT)))
	var target: Node = Node.new()
	var on_success: Callable = target.queue_free
	target.free()
	add_ok(SILENT)
	assert_true(await NetworkCore.send(request(SILENT), on_success), "a destroyed success callback is still success")
	assert_eq(completed, PackedStringArray([SILENT + ":true", SILENT + ":false", SILENT + ":true"]))
	assert_eq(error_logs(), 2)


## The `error_display` hook of the tests: a rate-limited toast.
class _Hook extends RefCounted:
	static var calls: int = 0

	static func display(_code: int, _request_name: String) -> ErrorDisplay:
		calls += 1
		var out: ErrorDisplay = ErrorDisplay.new()
		out.kind = NetworkCore.ErrorDisplayKind.TOAST
		out.translation_key = ReservedString.network_error_rate_limited()
		return out
