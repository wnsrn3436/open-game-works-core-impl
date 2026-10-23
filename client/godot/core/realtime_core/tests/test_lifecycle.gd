extends RealtimeTestCase
## `init`, `release`, teardown without `release`, calls outside `init`, `set_transport` after `init`, and no server
## request from RealtimeCore.


func test_release_puts_every_static_var_back_and_removes_the_core_node() -> void:
	await start_realtime()
	assert_true(RealtimeCore.is_initialized())
	var node: Node = RealtimeCore._node
	assert_true(is_instance_valid(node) and node.is_inside_tree())
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await reach_room(PackedInt64Array([USER_ID, OTHER_ID]))
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.start_room()
	await frames()
	push_match_found(make_info())
	await frames()
	RealtimeCore.release()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_false(RealtimeCore.is_initialized())
	_assert_initial_state()
	assert_false(node.is_inside_tree())
	assert_eq(error_logs(), 0)
	assert_eq(warn_logs(), 0)


func test_tree_teardown_without_release_clears_like_release() -> void:
	await start_realtime()
	await reach_playing()
	var node: Node = RealtimeCore._node
	node.free()
	assert_false(RealtimeCore.is_initialized())
	_assert_initial_state()
	RealtimeCore.set_transport(transport)
	assert_true(RealtimeCore.init())
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)


func test_init_of_an_initialized_module_fails() -> void:
	await start_realtime()
	assert_false(RealtimeCore.init())
	assert_eq(error_logs(), 1)
	assert_true(RealtimeCore.is_initialized())


func test_init_again_after_release_works_like_the_first_init() -> void:
	await start_realtime()
	await reach_playing()
	RealtimeCore.release()
	RealtimeCore.set_transport(transport)
	assert_true(RealtimeCore.init())
	await reach_playing()
	assert_eq(RealtimeCore.match_info().match_id, MATCH_ID)


func test_operations_outside_init_log_errors_and_return_failure_values() -> void:
	await start_realtime(true, false)
	assert_eq((await RealtimeCore.join_match(MODE_ID)).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq((await RealtimeCore.rejoin_match(MATCH_ID)).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(RealtimeCore.saved_match_id(), "")
	RealtimeCore.leave()
	RealtimeCore.end_match()
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)
	assert_eq(RealtimeCore.match_info().match_id, "")
	assert_eq(RealtimeCore.peer_state(0), RealtimeCore.PeerState.LEFT)
	assert_eq(RealtimeCore.match_time_ms(), -9223372036854775807 - 1)
	assert_false(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1])))
	assert_false((await RealtimeCore.create_room(MODE_ID)).ok)
	assert_false((await RealtimeCore.join_room(ROOM_CODE)).ok)
	RealtimeCore.leave_room()
	assert_false(RealtimeCore.kick_room_member(OTHER_ID))
	assert_eq((await RealtimeCore.start_room()).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq((await RealtimeCore.wait_match()).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(RealtimeCore.room_info().room_code, "")
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_false(RealtimeCore.register_on_realtime_message(owner.on_message))
	assert_eq(error_logs(), 18)
	assert_eq(transport.calls.size(), 0)


func test_set_transport_after_init_is_ignored_with_an_error() -> void:
	await start_realtime()
	var other: RealtimeRecordingTransport = RealtimeRecordingTransport.new(UnitTestCore.create_fake_realtime())
	RealtimeCore.set_transport(other)
	assert_eq(error_logs(), 1)
	await start_join()
	assert_eq(transport.count("start_matching"), 1)
	assert_eq(other.calls.size(), 0)


func test_operations_needing_a_transport_fail_with_an_error_without_one() -> void:
	await start_realtime(false)
	assert_eq((await RealtimeCore.join_match(MODE_ID)).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_false((await RealtimeCore.create_room(MODE_ID)).ok)
	assert_false((await RealtimeCore.join_room(ROOM_CODE)).ok)
	assert_eq((await RealtimeCore.start_room()).status, RealtimeCore.MatchJoinStatus.FAILED)
	assert_eq(error_logs(), 4)
	assert_eq(RealtimeCore.match_state(), RealtimeCore.MatchState.NONE)


func test_no_operation_sends_a_server_request() -> void:
	# After the login, the fake network receives only the `LogCore` reports of the warn logs.
	await start_realtime()
	var before: int = UnitTestCore.received_requests().size()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await reach_room(PackedInt64Array([USER_ID, OTHER_ID]))
	assert_true(RealtimeCore.kick_room_member(OTHER_ID))
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.start_room()
	await frames()
	push_match_found(make_info())
	await frames()
	push_peer_connected(1)
	await frames()
	await op.wait()
	assert_true(RealtimeCore.send(RealtimeCore.ALL, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1])))
	push_message(1, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([2]))
	push_peer_lost(1)
	await frames()
	push_peer_connected(1)
	push_matchmaker_lost(0)
	await frames()
	push_rejoined(true)
	await frames()
	assert_true(RealtimeCore.match_time_ms() != -9223372036854775807 - 1)
	RealtimeCore.end_match()
	RealtimeCore.leave_room()
	await frames()
	assert_eq(owner.messages.size(), 1)
	# The matchmaker lost in the room and in Playing, and leave_room after the lost emptied the room.
	assert_eq(warn_logs(), 3)
	var requests: Array[UnitTestRequest] = UnitTestCore.received_requests()
	for i: int in range(before, requests.size()):
		assert_eq(requests[i].name, REPORT_ERRORS, "request after the login")


func _assert_initial_state() -> void:
	assert_null(RealtimeCore._session)
	assert_null(RealtimeCore._node)
	assert_null(RealtimeCore._transport)
	assert_eq(RealtimeCore._connect_timeout_ms, 0)
	assert_eq(RealtimeCore._reconnect_timeout_ms, 0)
	assert_eq(RealtimeCore._background_timeout_ms, 0)
	assert_eq(RealtimeCore._message_max_bytes, 0)
	assert_eq(RealtimeCore._pending_max, 0)
	assert_eq(RealtimeCore._retry_delay_ms, 0)
	assert_eq(RealtimeCore._retry_factor_permille, 0)
	assert_eq(RealtimeCore._retry_delay_max_ms, 0)
	assert_eq(RealtimeCore._state, RealtimeCore.MatchState.NONE)
	assert_eq(RealtimeCore._origin, RealtimeCore.MatchOrigin.NONE)
	assert_null(RealtimeCore._info)
	assert_eq(RealtimeCore._peer_states.size(), 0)
	assert_eq(RealtimeCore._lost_at.size(), 0)
	assert_eq(RealtimeCore._connecting_at, 0)
	assert_null(RealtimeCore._waiter)
	assert_false(RealtimeCore._room_started_published)
	assert_eq(RealtimeCore._none_count, 0)
	assert_eq(RealtimeCore._change_count, 0)
	assert_null(RealtimeCore._room)
	assert_null(RealtimeCore._room_waiter)
	assert_true(RealtimeCore._hook.is_null())
	assert_eq(RealtimeCore._pending.size(), 0)
	assert_false(RealtimeCore._pending_full_logged)
	assert_false(RealtimeCore._hook_throw_logged)
	assert_eq(RealtimeCore._send_buffer.size(), 0)
	assert_eq(RealtimeCore._receive_buffer.size(), 0)
	assert_eq(RealtimeCore._open_op, RealtimeCore.OpenOp.NONE)
	assert_eq(RealtimeCore._open_mode_id, 0)
	assert_eq(RealtimeCore._open_room_code, "")
	assert_eq(RealtimeCore._open_match_id, "")
	assert_false(RealtimeCore._open_retried)
	assert_true(RealtimeCore._refresh_task.is_null())
	assert_eq(RealtimeCore._rejoin_phase, RealtimeCore.RejoinPhase.IDLE)
	assert_true(RealtimeCore._rejoin_first)
	assert_eq(RealtimeCore._rejoin_delay_ms, 0)
	assert_eq(RealtimeCore._rejoin_at, 0)
	assert_eq(RealtimeCore._rejoin_generation, 0)
	assert_true(RealtimeCore._rejoin_task.is_null())
