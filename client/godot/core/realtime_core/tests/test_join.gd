extends RealtimeTestCase
## `join_match`: the state order, the failures, the `MatchInfo` check, the connect time limit and `leave` before
## `Playing`.


func test_join_match_goes_matching_connecting_playing_with_the_match_info() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.join_match(MODE_ID)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING)
	assert_eq(transport.calls, PackedStringArray(["start_matching(%d, %s, false)" % [MODE_ID, ACCESS_TOKEN]]))
	var info: MatchInfo = make_info(3, 1)
	push_match_found(info)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.CONNECTING)
	assert_eq(transport.count("connect_peer"), 2)
	assert_has(transport.calls, "connect_peer(0)")
	assert_has(transport.calls, "connect_peer(2)")
	push_peer_connected(0)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.CONNECTING)
	assert_false(op.done)
	push_peer_connected(2)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.SUCCESS)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)
	var got: MatchInfo = RealtimeCore.match_info()
	assert_eq(got.match_id, info.match_id)
	assert_eq(got.mode_id, info.mode_id)
	assert_eq(got.my_index, info.my_index)
	assert_eq(got.user_ids, info.user_ids)
	assert_eq(got.teams, info.teams)
	assert_eq(got.parties, info.parties)
	assert_eq(got.match_seed, info.match_seed)
	assert_eq(got.start_at, info.start_at)
	assert_eq(got.lockstep, info.lockstep)


func test_own_peer_state_is_connected_in_connecting_and_playing_without_logs() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	push_match_found(make_info(2, 1))
	await frames()
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)
	assert_eq(RealtimeCore.peer_state(0), RealtimeCore.PeerState.WAITING)
	push_peer_connected(0)
	await frames()
	await op.wait()
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)
	assert_eq(warn_logs(), 0)
	assert_eq(error_logs(), 0)


func test_match_failed_gives_its_reason_and_error_code() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	push_match_failed(CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED, 1234)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.fail_reason, CoreContract.MatchFailReason.MATCH_FAIL_REASON_REJECTED)
	assert_eq(op.join_result.error_code, 1234)
	assert_eq(transport.count("close"), 1)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(warn_logs(), 1)


func test_matchmaker_lost_in_matching_fails_with_its_code() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	push_matchmaker_lost(CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.error_code, CoreContract.CoreError.CORE_ERROR_MAINTENANCE)
	assert_eq(op.join_result.fail_reason, CoreContract.MatchFailReason.MATCH_FAIL_REASON_UNSPECIFIED)
	op = await start_join()
	push_matchmaker_lost(0)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(op.join_result.error_code, 0)
	assert_eq(warn_logs(), 2)


func test_join_match_outside_none_fails_at_once_without_transport_operations() -> void:
	await start_realtime()
	await start_join()
	transport.clear_calls()
	var result: MatchJoinResult = await RealtimeCore.join_match(MODE_ID)
	assert_eq(result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(warn_logs(), 1)
	assert_eq(transport.calls.size(), 0)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING)


func test_each_failure_closes_goes_none_and_fails_with_its_log_level() -> void:
	await start_realtime()
	# Matchmaker lost, match failed: warn.
	var op: RealtimeAsyncCall = await start_join()
	push_matchmaker_lost(0)
	await frames()
	await _assert_failed(op, false)
	op = await start_join()
	push_match_failed(CoreContract.MatchFailReason.MATCH_FAIL_REASON_TIMEOUT, 0)
	await frames()
	await _assert_failed(op, false)
	# MatchInfo check: error.
	op = await start_join()
	var info: MatchInfo = make_info()
	info.match_id = ""
	push_match_found(info)
	await frames()
	await _assert_failed(op, true)
	# Connect time limit: warn.
	op = await start_join()
	push_match_found(make_info())
	await frames()
	await advance(CONNECT_TIMEOUT_MS)
	await _assert_failed(op, false)
	# Leave notice in Connecting: warn.
	op = await start_join()
	push_match_found(make_info(3, 0))
	await frames()
	push_peer_connected(1)
	await frames()
	push_leave_notice(1, 1)
	await frames()
	await _assert_failed(op, false)
	# Background time limit: warn.
	add_background_return_results()
	op = await start_join()
	UnitTestCore.advance_clock(BACKGROUND_TIMEOUT_MS, false, true)
	await frames()
	await _assert_failed(op, false)


func test_join_match_without_an_access_token_closes_goes_none_and_fails_with_a_warning() -> void:
	await start_realtime()
	await lose_access_token()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.join_match(MODE_ID)
	await frames(5)
	assert_true(op.done, "join_match ended")
	await _assert_failed(op, false)
	assert_eq(transport.count("start_matching"), 0)
	assert_eq(error_logs(), 0)


func test_each_match_info_check_condition_fails_the_check() -> void:
	await start_realtime()
	var cases: Array[MatchInfo] = []
	var info: MatchInfo = make_info()
	info.match_id = ""
	cases.append(info)
	info = make_info()
	info.user_ids = PackedInt64Array([USER_ID])
	info.teams = PackedInt64Array([0])
	info.parties = PackedInt64Array([0])
	cases.append(info)
	info = make_info()
	info.my_index = 2
	cases.append(info)
	info = make_info()
	info.my_index = -1
	cases.append(info)
	info = make_info()
	info.user_ids[1] = 0
	cases.append(info)
	info = make_info()
	info.user_ids[1] = -5
	cases.append(info)
	info = make_info()
	info.user_ids[1] = USER_ID
	cases.append(info)
	info = make_info()
	info.user_ids[0] = 9999
	cases.append(info)
	for count_change: int in PackedInt32Array([-1, 1]):
		info = make_info()
		info.teams.resize(info.teams.size() + count_change)
		cases.append(info)
		info = make_info()
		info.parties.resize(info.parties.size() + count_change)
		cases.append(info)
	for bad: MatchInfo in cases:
		var op: RealtimeAsyncCall = await start_join()
		push_match_found(bad)
		await frames()
		await op.wait()
		assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
		assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
		assert_eq(error_logs(), 1)


func test_connect_time_limit_fails_at_the_limit_and_not_before() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	push_match_found(make_info())
	await frames()
	await advance(CONNECT_TIMEOUT_MS - 1)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.CONNECTING)
	assert_false(op.done)
	await advance(1)
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(warn_logs(), 1)


func test_peer_lost_in_connecting_waits_and_connects_again_without_a_new_limit() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	push_match_found(make_info(3, 0))
	await frames()
	push_peer_connected(1)
	push_peer_lost(1)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.CONNECTING)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.WAITING)
	assert_eq(transport.count("connect_peer"), 3)
	assert_eq(transport.calls[transport.calls.size() - 1], "connect_peer(1)")
	await advance(CONNECT_TIMEOUT_MS)
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(warn_logs(), 1)


func test_leave_in_matching_cancels_matching_and_in_connecting_sends_the_leave_notice() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	RealtimeCore.leave()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.CANCELLED)
	assert_eq(transport.count("cancel_matching"), 1)
	assert_eq(transport.count("close"), 1)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	op = await start_join()
	push_match_found(make_info(3, 0))
	await frames()
	push_peer_connected(1)
	await frames()
	transport.clear_calls()
	RealtimeCore.leave()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.CANCELLED)
	assert_eq(transport.packets.size(), 1)
	assert_eq(transport.packet_targets[0], 1)
	assert_eq(transport.packets[0], PackedByteArray([1, 1, 1]))
	assert_eq(transport.calls, PackedStringArray(["send_packet(1, 0)", "close()"]))
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)


func test_leave_in_none_logs_a_warning_and_does_nothing() -> void:
	await start_realtime()
	RealtimeCore.leave()
	assert_eq(warn_logs(), 1)
	assert_eq(transport.calls.size(), 0)


func test_match_found_outside_matching_is_dropped_with_a_warning() -> void:
	await start_realtime()
	push_match_found(make_info())
	await frames()
	assert_eq(warn_logs(), 1)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(transport.calls.size(), 0)


func _assert_failed(op: RealtimeAsyncCall, is_error: bool) -> void:
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(transport.count("close"), 1)
	transport.clear_calls()
	if is_error:
		assert_eq(error_logs(), 1)
		assert_eq(warn_logs(), 0)
	else:
		assert_eq(warn_logs(), 1)
