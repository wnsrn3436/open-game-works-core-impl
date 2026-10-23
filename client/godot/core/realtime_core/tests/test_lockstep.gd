extends RealtimeTestCase
## The DEV lockstep transport around the fake realtime transport: lockstep flag, steps, step ends, the sequencer and
## the lockstep match time.

var lockstep: LockstepRealtimeTransport = null


func before_each() -> void:
	super()
	lockstep = null


func test_lockstep_flag_follows_the_step_mode() -> void:
	await _start_lockstep()
	TimeCoreDev.set_step_mode(true)
	var op: RealtimeAsyncCall = await start_join()
	assert_eq(transport.calls[0], "start_matching(%d, %s, true)" % [MODE_ID, ACCESS_TOKEN])
	RealtimeCore.leave()
	await op.wait()
	TimeCoreDev.set_step_mode(false)
	transport.clear_calls()
	op = await start_join()
	assert_eq(transport.calls[0], "start_matching(%d, %s, false)" % [MODE_ID, ACCESS_TOKEN])
	RealtimeCore.leave()
	await op.wait()
	TimeCoreDev.set_step_mode(true)
	transport.clear_calls()
	var room: RealtimeAsyncCall = RealtimeAsyncCall.new()
	room.create_room(MODE_ID)
	await frames()
	assert_eq(transport.calls[0], "open_room(%d, , %s, true)" % [MODE_ID, ACCESS_TOKEN])
	RealtimeCore.leave_room()
	await room.wait()


func test_sequencer_request_step_sends_the_step_runs_it_and_sends_its_end() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 0)
	transport.clear_calls()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(100)
	assert_eq(transport.packets.size(), 1)
	assert_eq(transport.packet_targets[0], 1)
	assert_eq(transport.packets[0], PackedByteArray([1, 2, 0, 0, 0, 1, 0, 0, 0, 100]))
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 100)
	var game_time: int = TimeCore.get_game_time()
	await advance(100)
	await frames()
	await op.wait()
	assert_true(op.step_result)
	assert_eq(TimeCore.get_game_time(), game_time + 100)
	assert_eq(transport.packets.size(), 2)
	assert_eq(transport.packets[1], PackedByteArray([1, 3, 0, 0, 0, 1]))


func test_non_sequencer_request_step_sends_a_request_and_runs_the_step_it_gets() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 1)
	transport.clear_calls()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(100)
	assert_eq(transport.packets.size(), 1)
	assert_eq(transport.packet_targets[0], 0)
	assert_eq(transport.packets[0], PackedByteArray([1, 4, 0, 0, 0, 100]))
	_push_step(0, 1, 100)
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 100)
	await advance(100)
	await frames()
	await op.wait()
	assert_true(op.step_result)
	assert_eq(transport.packets[transport.packets.size() - 1], PackedByteArray([1, 3, 0, 0, 0, 1]))


func test_next_step_waits_for_the_ends_of_the_participants_not_closed() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(3, 1)
	_push_step(0, 1, 100)
	_push_step(0, 2, 50)
	await frames()
	await advance(100)
	await frames()
	var game_time: int = TimeCore.get_game_time()
	var match_time: int = RealtimeCore.match_time_ms()
	await advance(200)
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	assert_eq(TimeCore.get_game_time(), game_time)
	assert_eq(RealtimeCore.match_time_ms(), match_time)
	_push_end(0, 1)
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	push_leave_notice(2, 1)
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 50)


func test_new_sequencer_makes_the_waiting_request_step_and_others_send_the_request_again() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(3, 1)
	transport.clear_calls()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(30)
	assert_eq(transport.packets[0], PackedByteArray([1, 4, 0, 0, 0, 30]))
	push_leave_notice(0, 1)
	await frames()
	var to_two: int = transport.packet_targets.find(2)
	assert_true(to_two >= 0)
	assert_eq(transport.packets[to_two], PackedByteArray([1, 2, 0, 0, 0, 1, 0, 0, 0, 30]))
	await advance(30)
	await frames()
	await op.wait()
	assert_true(op.step_result)


func test_third_participant_sends_its_request_again_to_the_new_sequencer() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(3, 2)
	transport.clear_calls()
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(30)
	assert_eq(transport.packet_targets[0], 0)
	push_leave_notice(0, 1)
	await frames()
	assert_eq(transport.packets.size(), 2)
	assert_eq(transport.packet_targets[1], 1)
	assert_eq(transport.packets[1], PackedByteArray([1, 4, 0, 0, 0, 30]))
	RealtimeCore.end_match()
	await op.wait()
	assert_false(op.step_result)


func test_message_before_a_step_end_reaches_the_hook_before_the_next_step_starts() -> void:
	await _start_lockstep()
	var owner: _BudgetOwner = add_node(_BudgetOwner.new()) as _BudgetOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await _reach_lockstep_playing(2, 0)
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(100)
	await frames()
	await advance(100)
	await frames()
	await op.wait()
	op = RealtimeAsyncCall.new()
	op.request_step(40)
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([3]))
	_push_end(1, 1)
	await frames()
	assert_eq(owner.budgets, PackedInt64Array([0]))
	assert_eq(TimeCoreDev.get_step_budget(), 40)
	RealtimeCore.end_match()
	await op.wait()


func test_lockstep_match_time_is_the_sum_of_the_steps_after_every_other_connected() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 0)
	assert_eq(RealtimeCore.match_time_ms(), 0)
	for ms: int in PackedInt32Array([100, 50]):
		var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
		op.request_step(ms)
		await frames()
		await advance(ms)
		await frames()
		await op.wait()
		_push_end(1, lockstep._finished_step)
		await frames()
	assert_eq(RealtimeCore.match_time_ms(), 150)


func test_sequencer_sends_the_steps_again_after_a_reconnect() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 0)
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(100)
	await frames()
	await advance(100)
	await frames()
	await op.wait()
	_push_end(1, 1)
	await frames()
	op = RealtimeAsyncCall.new()
	op.request_step(20)
	await frames()
	transport.clear_calls()
	push_peer_lost(1)
	await frames()
	push_peer_connected(1)
	await frames()
	var resent: int = 0
	for i: int in transport.packets.size():
		if transport.packet_targets[i] == 1 and transport.packets[i] == PackedByteArray([1, 2, 0, 0, 0, 2, 0, 0, 0, 20]):
			resent += 1
	assert_eq(resent, 1)
	assert_false(transport.packets.has(PackedByteArray([1, 2, 0, 0, 0, 1, 0, 0, 0, 100])))
	RealtimeCore.end_match()
	await op.wait()


func test_other_participant_sends_its_last_end_again_after_a_reconnect_and_drops_a_known_step() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 1)
	_push_step(0, 1, 100)
	await frames()
	await advance(100)
	await frames()
	transport.clear_calls()
	push_peer_lost(0)
	await frames()
	push_peer_connected(0)
	await frames()
	assert_has(transport.packets, PackedByteArray([1, 3, 0, 0, 0, 1]))
	_push_step(0, 1, 100)
	await frames()
	assert_eq(TimeCoreDev.get_step_budget(), 0)
	assert_eq(lockstep._finished_step, 1)


func test_waiting_request_is_sent_again_once_when_the_sequencer_reconnects() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 1)
	push_peer_lost(0)
	await frames()
	# The request is lost: the P2P peer of the sequencer is gone, and `close_peer` keeps index 0 the sequencer.
	UnitTestCore.set_realtime_send_result(fake, 0, false)
	var op: RealtimeAsyncCall = RealtimeAsyncCall.new()
	op.request_step(100)
	await frames()
	assert_false(op.done)
	UnitTestCore.set_realtime_send_result(fake, 0, true)
	transport.clear_calls()
	push_peer_connected(0)
	await frames()
	var request: PackedByteArray = PackedByteArray([1, 4, 0, 0, 0, 100])
	var resent: int = 0
	for i: int in transport.packets.size():
		if transport.packet_targets[i] == 0 and transport.packets[i] == request:
			resent += 1
	assert_eq(resent, 1)
	_push_step(0, 1, 100)
	await frames()
	await advance(100)
	await frames()
	await op.wait()
	assert_true(op.step_result)
	# The request has its step: a later reconnect of the sequencer does not send it again.
	transport.clear_calls()
	push_peer_lost(0)
	await frames()
	push_peer_connected(0)
	await frames()
	assert_false(transport.packets.has(request))


func test_lockstep_notices_do_not_reach_the_hook_or_the_leave_handling() -> void:
	await _start_lockstep()
	var owner: _BudgetOwner = add_node(_BudgetOwner.new()) as _BudgetOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await _reach_lockstep_playing(2, 1)
	_push_step(0, 1, 10)
	_push_end(0, 1)
	push_packet(0, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 4, 0, 0, 0, 10]))
	await frames()
	assert_eq(owner.budgets.size(), 0)
	assert_eq(warn_logs(), 0)
	assert_eq(events.count("left"), 0)
	assert_eq(RealtimeCore.peer_state(0), RealtimeCore.PeerState.CONNECTED)


func test_request_step_without_step_mode_fails() -> void:
	await _start_lockstep()
	await _reach_lockstep_playing(2, 0)
	TimeCoreDev.set_step_mode(false)
	assert_false(await RealtimeCoreDev.request_step(100))
	assert_eq(warn_logs(), 1)


func _start_lockstep() -> void:
	await start_realtime(false, false)
	lockstep = LockstepRealtimeTransport.new(transport)
	RealtimeCore.set_transport(lockstep)
	assert_true(RealtimeCore.init())


func _reach_lockstep_playing(count: int, my_index: int) -> void:
	TimeCoreDev.set_step_mode(true)
	var op: RealtimeAsyncCall = await start_join()
	var info: MatchInfo = make_info(count, my_index)
	info.lockstep = true
	push_match_found(info)
	await frames()
	for i: int in count:
		if i != my_index:
			push_peer_connected(i)
	await frames()
	await op.wait()
	assert_eq(op.join_result.status, RealtimeCore.MatchJoinStatus.SUCCESS)


func _push_step(sender: int, k: int, ms: int) -> void:
	push_packet(sender, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 2, 0, 0, 0, k, 0, 0, 0, ms]))


func _push_end(sender: int, k: int) -> void:
	push_packet(sender, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 3, 0, 0, 0, k]))


## Hook owner that keeps the step budget left when each message came.
class _BudgetOwner extends Node:
	var budgets: PackedInt64Array = PackedInt64Array()

	func on_message(_participant: int, _channel: RealtimeCore.RealtimeChannel, _bytes: PackedByteArray) -> void:
		budgets.append(TimeCoreDev.get_step_budget())
