extends RealtimeTestCase
## Matchmaker lost: the error code handling, the in-match rejoin and its rejoin delay.

const STOP_CODES: PackedInt32Array = [
	CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED,
	CoreContract.CoreError.CORE_ERROR_BANNED,
	CoreContract.CoreError.CORE_ERROR_MAINTENANCE,
	CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED,
	CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED,
]


func test_matchmaker_lost_in_playing_rejoins_once_and_keeps_participants() -> void:
	await start_realtime()
	await reach_playing(3, 0)
	push_peer_lost(2)
	await frames()
	transport.clear_calls()
	push_matchmaker_lost(0)
	await frames()
	assert_eq(warn_logs(), 1)
	assert_eq(transport.calls, PackedStringArray(["rejoin(%s, %s)" % [MATCH_ID, ACCESS_TOKEN]]))
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)
	assert_eq(RealtimeCore.peer_state(2), RealtimeCore.PeerState.DISCONNECTED)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_match_found_in_playing_is_dropped_and_keeps_the_match_info() -> void:
	await start_realtime()
	await reach_playing()
	var other: MatchInfo = make_info()
	other.match_id = "match-other"
	push_match_found(other)
	await frames()
	assert_eq(warn_logs(), 1)
	assert_eq(RealtimeCore.match_info().match_id, MATCH_ID)


func test_stop_codes_in_playing_do_not_rejoin() -> void:
	await start_realtime()
	for code: int in STOP_CODES:
		if code == CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED:
			continue
		await reach_playing()
		transport.clear_calls()
		push_matchmaker_lost(code)
		await frames()
		await advance(RETRY_DELAY_MAX_MS * 4)
		assert_eq(warn_logs(), 1)
		assert_eq(transport.count("rejoin"), 0)
		assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)
		RealtimeCore.end_match()


func test_session_replaced_in_playing_does_not_rejoin() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	await frames()
	await advance(RETRY_DELAY_MAX_MS * 4)
	assert_eq(warn_logs(), 1)
	assert_eq(transport.count("rejoin"), 0)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_rejoin_delay_grows_by_the_factor_up_to_the_max() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	push_matchmaker_lost(0)
	await frames()
	assert_eq(transport.count("rejoin"), 1)
	assert_eq(warn_logs(), 1)
	var delays: PackedInt32Array = [RETRY_DELAY_MS, RETRY_DELAY_MS * RETRY_FACTOR_PERMILLE / 1000, RETRY_DELAY_MAX_MS, RETRY_DELAY_MAX_MS]
	var rejoins: int = 1
	for delay: int in delays:
		push_matchmaker_lost(0)
		await frames()
		assert_eq(warn_logs(), 1)
		await advance(delay - 1)
		await frames()
		assert_eq(transport.count("rejoin"), rejoins)
		await advance(1)
		await frames()
		rejoins += 1
		assert_eq(transport.count("rejoin"), rejoins)
	push_rejoined(true)
	await frames()
	await advance(RETRY_DELAY_MAX_MS * 4)
	assert_eq(transport.count("rejoin"), rejoins)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_in_match_rejoin_without_an_access_token_goes_on_as_after_a_code_0_matchmaker_lost() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	await lose_access_token()
	push_matchmaker_lost(0)
	await frames(5)
	assert_eq(transport.calls.size(), 0, "no rejoin without an access token")
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)
	assert_eq(warn_logs(), 2, "the matchmaker lost and the missing access token")
	# Like a code 0 matchmaker lost after the first rejoin: the next rejoin waits the first rejoin delay.
	add_refresh_result()
	await advance(RETRY_DELAY_MS - 1)
	await frames(5)
	assert_eq(transport.count("rejoin"), 0)
	await advance(1)
	await frames(5)
	assert_eq(transport.calls, PackedStringArray(["rejoin(%s, %s)" % [MATCH_ID, NEW_ACCESS_TOKEN]]))
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_rejoined_failure_and_maintenance_stop_the_in_match_rejoin() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	push_matchmaker_lost(0)
	await frames()
	push_rejoined(false)
	await frames()
	assert_eq(warn_logs(), 2)
	await advance(RETRY_DELAY_MAX_MS * 4)
	assert_eq(transport.count("rejoin"), 1)
	push_matchmaker_lost(0)
	await frames()
	assert_eq(transport.count("rejoin"), 2)
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	await frames()
	await advance(RETRY_DELAY_MAX_MS * 4)
	assert_eq(transport.count("rejoin"), 2)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)
	assert_eq(warn_logs(), 2)


func test_leave_while_waiting_the_rejoin_delay_stops_the_rejoin() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	push_matchmaker_lost(0)
	await frames()
	push_matchmaker_lost(0)
	await frames()
	RealtimeCore.leave()
	await advance(RETRY_DELAY_MAX_MS * 4)
	assert_eq(transport.count("rejoin"), 1)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)


func test_update_and_session_codes_in_matching_notify_network_core_once() -> void:
	await start_realtime()
	var sink: _EventSink = add_node(_EventSink.new()) as _EventSink
	assert_true(EventCore.subscribe(UpdateRequiredEvent, sink.on_update_required))
	var codes: PackedInt32Array = [
		CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED,
		CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED,
		CoreContract.CoreError.CORE_ERROR_MAINTENANCE,
	]
	for code: int in codes:
		var op: RealtimeAsyncCall = await start_join()
		push_matchmaker_lost(code)
		await frames()
		await op.wait()
		assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
		assert_eq(op.join_result.error_code, code)
	assert_eq(sink.update_codes, PackedInt32Array([CoreContract.CoreError.CORE_ERROR_APP_UPDATE_REQUIRED, CoreContract.CoreError.CORE_ERROR_DATA_UPDATE_REQUIRED]))


func test_session_replaced_in_matching_notifies_network_core_and_fails() -> void:
	await start_realtime()
	var sink: _EventSink = add_node(_EventSink.new()) as _EventSink
	assert_true(EventCore.subscribe(SessionEndedEvent, sink.on_session_ended))
	var op: RealtimeAsyncCall = await start_join()
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.error_code, CoreContract.CoreError.CORE_ERROR_SESSION_REPLACED)
	assert_eq(sink.session_reasons, PackedInt32Array([AuthCore.SessionEndReason.REPLACED]))


func test_token_expired_in_matching_refreshes_and_starts_matching_again_once() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	transport.clear_calls()
	add_refresh_result()
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	await frames(5)
	assert_eq(transport.calls, PackedStringArray(["start_matching(%d, %s, false)" % [MODE_ID, NEW_ACCESS_TOKEN]]))
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING)
	assert_false(op.done)
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.error_code, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)


func test_token_expired_with_a_failed_refresh_fails_join_match() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	transport.clear_calls()
	add_error(REFRESH_TOKEN, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	await frames(5)
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.error_code, CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
	assert_eq(transport.count("start_matching"), 0)


func test_token_expired_drops_the_matchmaker_lost_when_join_match_restarts_while_the_refresh_waits() -> void:
	await start_realtime()
	for refresh_ok: bool in [true, false]:
		var label: String = "refresh ok %s" % refresh_ok
		var old_op: RealtimeAsyncCall = await start_join()
		UnitTestCore.add_pending(REFRESH_TOKEN)
		push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_TOKEN_EXPIRED)
		await frames(5)
		assert_false(old_op.done, label)
		RealtimeCore.leave()
		await old_op.wait()
		assert_eq(old_op.join_result.status, RealtimeCore.MatchJoinStatus.CANCELLED, label)
		var op: RealtimeAsyncCall = await start_join()
		assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING, label)
		transport.clear_calls()
		release_refresh(refresh_ok)
		await frames(5)
		assert_eq(transport.calls.size(), 0, label + ": nothing is reopened or closed")
		assert_false(op.done, label + ": the new join_match waits")
		assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING, label)
		assert_eq(warn_logs(), 0, label)
		push_match_found(make_info())
		await frames()
		push_peer_connected(1)
		await frames()
		await op.wait()
		assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.SUCCESS, label)
		RealtimeCore.end_match()
		await frames()


## Subscriber of the events other modules publish for RealtimeCore's error codes.
class _EventSink extends Node:
	var update_codes: PackedInt32Array = PackedInt32Array()
	var session_reasons: PackedInt32Array = PackedInt32Array()

	func on_update_required(event: UpdateRequiredEvent) -> void:
		update_codes.append(event.error_code)

	func on_session_ended(event: SessionEndedEvent) -> void:
		session_reasons.append(event.reason)
