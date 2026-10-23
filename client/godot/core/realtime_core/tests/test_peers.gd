extends RealtimeTestCase
## Disconnect, reconnect and leave of participants, the match end, the background time limit and the match time.


func test_peer_lost_in_playing_disconnects_and_reconnects_within_the_limit() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	push_peer_lost(1)
	await frames()
	assert_eq(events.lines, PackedStringArray(["disconnected:1"]))
	assert_eq(transport.calls, PackedStringArray(["connect_peer(1)"]))
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.DISCONNECTED)
	await advance(RECONNECT_TIMEOUT_MS - 1)
	push_peer_connected(1)
	await frames(1)
	assert_eq(events.lines, PackedStringArray(["disconnected:1", "reconnected:1"]))
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)


func test_reconnect_time_limit_leaves_the_participant_with_timeout() -> void:
	await start_realtime()
	await reach_playing()
	push_peer_lost(1)
	await frames()
	await advance(RECONNECT_TIMEOUT_MS - 1)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.DISCONNECTED)
	push_peer_lost(1)
	await frames(1)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.DISCONNECTED)
	await advance(1)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.LEFT)
	assert_eq(events.lines, PackedStringArray(["disconnected:1", "left:1:TIMEOUT"]))
	assert_has(transport.calls, "close_peer(1)")
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_leave_notice_leaves_once_and_a_left_participant_changes_nothing() -> void:
	await start_realtime()
	await reach_playing(3, 0)
	push_leave_notice(1, 1)
	push_leave_notice(2, 2)
	await frames()
	assert_eq(events.lines, PackedStringArray(["left:1:LEFT", "left:2:ENDED"]))
	transport.clear_calls()
	push_peer_lost(1)
	push_peer_connected(1)
	push_leave_notice(2, 1)
	push_peer_lost(2)
	await frames()
	assert_eq(transport.calls.size(), 0)
	assert_eq(events.lines.size(), 2)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.peer_state(2), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_leave_in_playing_ends_the_match_with_left() -> void:
	await start_realtime()
	await reach_playing(3, 0)
	push_peer_lost(2)
	await frames()
	transport.clear_calls()
	RealtimeCore.leave()
	assert_eq(transport.calls, PackedStringArray(["send_packet(1, 0)", "close()"]))
	assert_eq(transport.packets[0], PackedByteArray([1, 1, 1]))
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(events.lines[events.lines.size() - 1], "ended:%s:LEFT" % MATCH_ID)
	assert_eq(events.state_at_end, PackedInt32Array([RealtimeCore.MatchState.NONE]))


func test_end_match_ends_the_match_with_ended() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	RealtimeCore.end_match()
	assert_eq(transport.calls, PackedStringArray(["send_packet(1, 0)", "close()"]))
	assert_eq(transport.packets[0], PackedByteArray([1, 1, 2]))
	assert_eq(events.lines, PackedStringArray(["ended:%s:ENDED" % MATCH_ID]))
	assert_eq(events.state_at_end, PackedInt32Array([RealtimeCore.MatchState.NONE]))
	RealtimeCore.end_match()
	assert_eq(warn_logs(), 1)


func test_background_below_the_limit_changes_nothing_and_at_the_limit_ends_playing() -> void:
	await start_realtime()
	await reach_playing()
	_background(BACKGROUND_TIMEOUT_MS - 1)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)
	_background(BACKGROUND_TIMEOUT_MS)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(events.lines, PackedStringArray(["ended:%s:BACKGROUND_TIMEOUT" % MATCH_ID]))


func test_background_at_the_limit_fails_matching_and_connecting() -> void:
	await start_realtime()
	var op: RealtimeAsyncCall = await start_join()
	_background(BACKGROUND_TIMEOUT_MS - 1)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.MATCHING)
	_background(BACKGROUND_TIMEOUT_MS)
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	op = await start_join()
	push_match_found(make_info())
	await frames()
	_background(BACKGROUND_TIMEOUT_MS - 1)
	await frames()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.CONNECTING)
	_background(BACKGROUND_TIMEOUT_MS)
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(warn_logs(), 2)


func test_match_time_is_server_time_minus_the_start_time() -> void:
	await start_realtime()
	assert_eq(RealtimeCore.match_time_ms(), -9223372036854775807 - 1)
	assert_eq(error_logs(), 1)
	await reach_playing()
	await advance(500)
	assert_eq(RealtimeCore.match_time_ms(), TimeCore.get_server_time() - RealtimeCore.match_info().start_at)
	assert_true(RealtimeCore.match_time_ms() < 0)
	await advance(5000)
	assert_eq(RealtimeCore.match_time_ms(), TimeCore.get_server_time() - RealtimeCore.match_info().start_at)
	assert_true(RealtimeCore.match_time_ms() > 0)


func test_match_time_without_server_time_is_the_minimum_without_a_log() -> void:
	await start_realtime()
	await reach_playing()
	# A new TimeCore has no server time yet.
	TimeCore.release()
	assert_true(TimeCore.init())
	assert_false(TimeCore.is_synced())
	assert_eq(RealtimeCore.match_time_ms(), -9223372036854775807 - 1)
	assert_eq(error_logs(), 0)
	assert_eq(warn_logs(), 0)


func test_other_participants_all_leaving_keeps_playing() -> void:
	await start_realtime()
	await reach_playing(3, 0)
	push_leave_notice(1, 2)
	push_peer_lost(2)
	await frames()
	await advance(RECONNECT_TIMEOUT_MS)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.peer_state(2), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.PLAYING)


func test_peer_state_outside_a_match_or_out_of_the_list_is_left_with_an_error() -> void:
	await start_realtime()
	assert_eq(RealtimeCore.peer_state(0), RealtimeCore.PeerState.LEFT)
	assert_eq(error_logs(), 1)
	await reach_playing()
	assert_eq(RealtimeCore.peer_state(2), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.peer_state(-1), RealtimeCore.PeerState.LEFT)
	assert_eq(error_logs(), 2)
	assert_eq(RealtimeCore.match_info().match_id, MATCH_ID)
	RealtimeCore.end_match()
	assert_eq(RealtimeCore.match_info().match_id, "")
	assert_eq(RealtimeCore.match_info().user_ids.size(), 0)
	assert_eq(error_logs(), 0)


## A background of `ms` and the return from it, with the results of the requests the return sends.
func _background(ms: int) -> void:
	add_background_return_results()
	UnitTestCore.advance_clock(ms, false, true)
