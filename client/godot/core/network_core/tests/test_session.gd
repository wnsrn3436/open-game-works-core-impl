extends "res://core/network_core/tests/support/network_test_case.gd"
## Session-bound work: the log sender, session end state and the full resync flag.


func _batch_with_errors(count: int, dropped: int) -> LogBatch:
	var batch: LogBatch = LogBatch.new()
	for i: int in count:
		var entry: LogEntry = LogEntry.new()
		entry.time = 1700000000000 + i
		entry.level = LogCore.Level.ERROR
		entry.tag = "Test"
		entry.message = "message %d" % i
		batch.errors.append(entry)
	batch.dropped_error_count = dropped
	return batch


func _received_request(index: int, message: ContractMessage) -> bool:
	return message.decode(body_of(index))


func test_log_sender_sends_the_batch_parts() -> void:
	await start_network()
	add_ok("core/ReportClientErrors")
	NetworkCore._send_log_batch(_batch_with_errors(2, 0))
	await UnitTestCore.wait_frames(1)
	assert_eq(request_count(), 1, "errors only: ReportClientErrors only")
	var errors: CoreContract.ReportClientErrorsRequest = CoreContract.ReportClientErrorsRequest.new()
	assert_true(_received_request(0, errors))
	assert_eq(errors.errors.size(), 2)
	assert_eq(errors.errors[1].message, "message 1")
	assert_eq(errors.errors[1].time_at, 1700000000001)
	assert_eq(request_count("core/ReportAnalyticsEvents"), 0)
	# Both parts: both rpcs. Only dropped events: their count in ReportAnalyticsEvents.
	add_ok("core/ReportClientErrors")
	add_ok("core/ReportAnalyticsEvents")
	var both: LogBatch = _batch_with_errors(1, 0)
	both.dropped_event_count = 4
	NetworkCore._send_log_batch(both)
	await UnitTestCore.wait_frames(1)
	assert_eq(request_count("core/ReportClientErrors"), 2)
	assert_eq(request_count("core/ReportAnalyticsEvents"), 1)
	var events: CoreContract.ReportAnalyticsEventsRequest = CoreContract.ReportAnalyticsEventsRequest.new()
	assert_true(_received_request(2, events))
	assert_eq(events.events.size(), 0)
	assert_eq(events.dropped_event_count, 4)


func test_report_failures_are_warn_and_not_queued_again() -> void:
	assert_true(UnitTestCore.set_test_settings("LogCore.sendIntervalMs", 1000))
	await start_network()
	add_connection_failure("core/ReportClientErrors", 2 + RETRY_COUNT)
	NetworkCore._send_log_batch(_batch_with_errors(1, 0))
	for i: int in RETRY_COUNT:
		await advance(RETRY_DELAY_MAX_MS)
	assert_eq(request_count("core/ReportClientErrors"), 2 + RETRY_COUNT)
	assert_eq(warn_logs(), 1)
	# The failure log is a warn, so the next batch LogCore sends holds no error of it.
	NetworkCore.set_session_provider(provider)
	LogCore.log_error("Test", "one error")
	assert_eq(UnitTestCore.check_logs("error", "Test"), 1)
	add_ok("core/ReportClientErrors")
	await advance(1000)
	await advance(1000)
	assert_eq(request_count("core/ReportClientErrors"), 3 + RETRY_COUNT)
	var errors: CoreContract.ReportClientErrorsRequest = CoreContract.ReportClientErrorsRequest.new()
	assert_true(_received_request(request_count() - 1, errors))
	var tags: PackedStringArray = PackedStringArray()
	for entry: CoreContract.ClientErrorEntry in errors.errors:
		tags.append(entry.tag)
	assert_true(tags.has("Test"))
	assert_false(tags.has("NetworkCore"))


func test_session_end_drops_queued_requests() -> void:
	await start_network()
	UnitTestCore.add_pending(SILENT)
	var current: Sent = start_send(request(SILENT))
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	var first: Sent = start_send(request(INTERACTION), Callable(), on_failure)
	var second: Sent = start_send(request(INTERACTION), Callable(), on_failure)
	NetworkCore.set_session_provider(null)
	assert_false(await wait_sent(first))
	assert_false(await wait_sent(second))
	assert_eq(completed, PackedStringArray([INTERACTION + ":false", INTERACTION + ":false"]))
	assert_eq(warn_logs(), 1)
	assert_eq(calls[0], 0)
	assert_true(release_ok(SILENT))
	assert_true(await wait_sent(current), "the request already sent ends with its result")
	assert_eq(request_count(INTERACTION), 0)
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)
	# A send in session end state ends at once and quietly.
	assert_false(await NetworkCore.send(request(INTERACTION)))
	assert_eq(request_count(INTERACTION), 0)
	# A new SessionProvider ends session end state.
	NetworkCore.set_session_provider(FakeProvider.new())
	add_ok(INTERACTION)
	assert_true(await NetworkCore.send(request(INTERACTION)))
	assert_eq(request_count(INTERACTION), 1)


func test_retry_popup_retry_in_session_end_state_is_dropped() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_retry()))
	NetworkCore.set_session_provider(null)
	assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(RETRY), 2, "not passed to NetworkTransport")
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0)


func test_retry_popup_retry_after_max_retry_age_in_session_end_state_is_dropped() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_retry()))
	NetworkCore.set_session_provider(null)
	await advance(MAX_RETRY_AGE_MS)
	assert_true(await press_popup_button(ReservedString.network_retry()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(RETRY), 2, "not passed to NetworkTransport")
	await UnitTestCore.wait_frames(2)
	assert_eq(popup_count(), 0, "no retry exhausted popup")
	assert_eq(completed, PackedStringArray([RETRY + ":false"]))
	assert_eq(error_logs(), 0)
	assert_eq(warn_logs(), 0)


func test_failure_flow_send_again_after_max_retry_age_in_session_end_state_is_dropped() -> void:
	await start_network()
	var calls: Array[int] = [0]
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls[0] += 1
		return false
	# Step 4: the request was sent before the session ended and fails after it.
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION), Callable(), on_failure)
	assert_eq(request_count(INTERACTION), 1)
	NetworkCore.set_session_provider(null)
	UnitTestCore.set_device_time(TimeCore.get_device_time() + MAX_RETRY_AGE_MS)
	assert_true(UnitTestCore.release_pending(INTERACTION, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray()))
	assert_false(await wait_sent(sent))
	assert_eq(request_count(INTERACTION), 1, "not sent again")
	# Step 5: the session ends during the retry delay.
	NetworkCore.set_session_provider(FakeProvider.new())
	add_connection_failure(SILENT_RETRY, 2)
	var silent: Sent = start_send(request(SILENT_RETRY), Callable(), on_failure)
	assert_eq(request_count(SILENT_RETRY), 2, "the first send and the step 4 send again")
	NetworkCore.set_session_provider(null)
	UnitTestCore.set_device_time(TimeCore.get_device_time() + MAX_RETRY_AGE_MS)
	await advance(RETRY_DELAY_MS)
	assert_false(await wait_sent(silent))
	assert_eq(request_count(SILENT_RETRY), 2, "not sent again")
	await UnitTestCore.wait_frames(2)
	assert_eq(calls[0], 0, "no failure callback")
	assert_eq(popup_count(), 0)
	assert_eq(completed, PackedStringArray([INTERACTION + ":false", SILENT_RETRY + ":false"]))
	assert_eq(error_logs(), 0)
	assert_eq(warn_logs(), 0)


func _resync_full(index: int) -> bool:
	var message: CoreContract.ResyncRequest = CoreContract.ResyncRequest.new()
	assert_true(_received_request(index, message))
	return message.full


func _sync_time() -> void:
	add_ok(SILENT)
	assert_true(await NetworkCore.send(request(SILENT)))


func test_communication_failures_turn_on_full_resync() -> void:
	await start_network()
	for request_name: String in [INTERACTION, SILENT, SILENT_RETRY]:
		add_connection_failure(request_name, 2 + (RETRY_COUNT if request_name == SILENT_RETRY else 0))
		var sent: Sent = start_send(request(request_name), Callable(), func(_f: RequestFailure) -> bool: return true)
		if request_name == SILENT_RETRY:
			for i: int in RETRY_COUNT:
				await advance(RETRY_DELAY_MAX_MS)
		assert_false(await wait_sent(sent))
		add_ok(RESYNC)
		add_ok(RESYNC)
		assert_true(await NetworkCore.resync())
		assert_true(_resync_full(request_count() - 1), "Resync after a %s communication failure is full" % request_name)
		assert_true(await NetworkCore.resync())
		assert_false(_resync_full(request_count() - 1), "the Resync after a full Resync is not full")
	assert_eq(error_logs(), 3)


func test_background_return_sends_resync() -> void:
	await start_network()
	add_connection_failure(INTERACTION, 2)
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), func(_f: RequestFailure) -> bool: return true))
	await _sync_time()
	add_ok(RESYNC)
	UnitTestCore.advance_clock(5000, true)
	await UnitTestCore.wait_frames(2)
	assert_eq(request_count(RESYNC), 1, "background return sends Resync")
	assert_true(_resync_full(request_count() - 1))
	assert_eq(error_logs(), 1)


func test_resync_stays_not_full_after_other_failures() -> void:
	await start_network()
	add_connection_failure(RETRY, 2)
	var sent: Sent = start_send(request(RETRY))
	await UnitTestCore.wait_frames(2)
	UICore.close_all_popups()
	assert_false(await wait_sent(sent))
	add_ok(RESYNC)
	assert_true(await NetworkCore.resync())
	assert_false(_resync_full(request_count() - 1), "after a Retry communication failure")
	add_error(INTERACTION, GameContract.GameError.GAME_ERROR_CORE_TEST)
	assert_false(await NetworkCore.send(request(INTERACTION), Callable(), func(_f: RequestFailure) -> bool: return true))
	add_ok(RESYNC)
	assert_true(await NetworkCore.resync())
	assert_false(_resync_full(request_count() - 1), "after a ServerError")
	UnitTestCore.add_pending(SILENT)
	var current: Sent = start_send(request(SILENT))
	# The queue starts the next request after the caller of the ended request resumes.
	await UnitTestCore.wait_frames(1)
	assert_eq(request_count(SILENT), 1, "the Silent request is sending")
	var dropped: Sent = start_send(request(INTERACTION))
	NetworkCore.set_session_provider(null)
	assert_false(await wait_sent(dropped))
	# A send in session end state waits for the sending request and is dropped at its send attempt.
	var after_end: Sent = start_send(request(SILENT))
	assert_true(release_ok(SILENT))
	assert_true(await wait_sent(current))
	assert_false(await wait_sent(after_end))
	assert_eq(request_count(SILENT), 1, "the dropped send does not reach NetworkTransport")
	assert_false(NetworkCore._full_resync, "after requests dropped in session end state")
	assert_eq(error_logs(), 1)
	assert_eq(warn_logs(), 2)


func test_refused_delta_turns_on_full_resync_and_a_failed_full_resync_keeps_it() -> void:
	await start_network()
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array(), false, true)
	add_envelope(SILENT, env)
	assert_false(await NetworkCore.send(request(SILENT)))
	assert_eq(UnitTestCore.check_logs("error", "UserStateCore"), 1)
	add_connection_failure(RESYNC, 2)
	assert_false(await NetworkCore.resync())
	assert_true(_resync_full(request_count() - 1))
	add_ok(RESYNC)
	assert_true(await NetworkCore.resync())
	assert_true(_resync_full(request_count() - 1), "a Resync that failed full keeps the flag")
	assert_eq(error_logs(), 1)


func test_set_session_provider_release_and_init_turn_off_full_resync() -> void:
	await start_network()
	add_connection_failure(SILENT, 2)
	assert_false(await NetworkCore.send(request(SILENT)))
	NetworkCore.set_session_provider(FakeProvider.new())
	add_ok(RESYNC)
	assert_true(await NetworkCore.resync())
	assert_false(_resync_full(request_count() - 1), "set_session_provider")
	add_connection_failure(SILENT, 2)
	assert_false(await NetworkCore.send(request(SILENT)))
	NetworkCore.release()
	# `release` drops the fake network, so the requests after `init` go to a transport of this test.
	var transport: _OkTransport = _OkTransport.new()
	transport.response = ok_bytes()
	NetworkCoreDev.set_transport(transport)
	assert_true(NetworkCore.init())
	assert_true(NetworkCore.set_server_info(BASE_URL, APP_VERSION, CoreBuildInfo.platform))
	NetworkCore.set_session_provider(FakeProvider.new())
	assert_true(await NetworkCore.resync())
	assert_eq(transport.bodies.size(), 1)
	var message: CoreContract.ResyncRequest = CoreContract.ResyncRequest.new()
	assert_true(message.decode(transport.bodies[0]))
	assert_false(message.full, "release and init")
	assert_eq(error_logs(), 2)


func test_full_resync_response_replaces_the_cache() -> void:
	await start_network()
	var first: CoreContract.ResponseEnvelope = envelope()
	first.user_state = tutorial_delta(PackedInt64Array([1, 2]))
	add_envelope(SILENT, first)
	assert_true(await NetworkCore.send(request(SILENT)))
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 2)
	var full: CoreContract.ResponseEnvelope = envelope()
	full.user_state = tutorial_delta(PackedInt64Array([3, 4, 5]), true)
	add_envelope(RESYNC, full)
	assert_true(await NetworkCore.resync())
	assert_eq(UserStateCore.count(CoreContract.TutorialProgressUserState), 3, "only the upserts of the full delta stay")


## A `NetworkTransport` that answers every send with `response` and keeps the request bodies.
class _OkTransport extends NetworkTransport:
	var response: PackedByteArray = PackedByteArray()
	var bodies: Array[PackedByteArray] = []

	func send(handle: int, _url: String, _headers: PackedStringArray, body: PackedByteArray) -> NetworkTransportResult:
		bodies.append(body)
		var result: NetworkTransportResult = NetworkTransportResult.new()
		result.handle = handle
		result.transfer = NetworkCore.TransferResult.DONE
		result.http_status = 200
		result.body = response
		return result
