extends RealtimeTestCase
## DEV code: the network simulation transport, `force_peer_lost`, `force_matchmaker_lost` and `request_step` outside
## a lockstep match.


func test_simulation_with_full_loss_drops_unreliable_and_keeps_reliable_in_order() -> void:
	_start_time()
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLossPermille", 1000))
	var recording: RealtimeRecordingTransport = RealtimeRecordingTransport.new(UnitTestCore.create_fake_realtime())
	var sim: SimRealtimeTransport = SimRealtimeTransport.new(recording)
	for i: int in 10:
		assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([0, i])))
		assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([0, 100 + i])))
	sim.poll()
	assert_eq(recording.packets.size(), 10)
	for i: int in 10:
		assert_eq(recording.packets[i], PackedByteArray([0, 100 + i]))
		assert_eq(recording.calls[i], "send_packet(1, 0)")


func test_simulation_latency_delivers_after_the_latency() -> void:
	_start_time()
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLatencyMs", 100))
	var recording: RealtimeRecordingTransport = RealtimeRecordingTransport.new(UnitTestCore.create_fake_realtime())
	var sim: SimRealtimeTransport = SimRealtimeTransport.new(recording)
	assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([0, 1])))
	assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([0, 2])))
	UnitTestCore.advance_clock(99, false)
	sim.poll()
	assert_eq(recording.packets.size(), 0)
	UnitTestCore.advance_clock(1, false)
	sim.poll()
	assert_eq(recording.packets.size(), 2)


func test_simulation_with_the_same_match_seed_drops_the_same_packets() -> void:
	_start_time()
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLossPermille", 500))
	var first: PackedByteArray = _delivered_with_seed(MATCH_SEED)
	var second: PackedByteArray = _delivered_with_seed(MATCH_SEED)
	assert_eq(first, second)
	assert_true(first.size() > 0 and first.size() < 40)


func test_simulation_with_latency_sends_the_leave_notice_of_end_match_before_close() -> void:
	await start_realtime(false, false)
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLatencyMs", 100))
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simJitterMs", 15))
	RealtimeCore.set_transport(SimRealtimeTransport.new(transport))
	assert_true(RealtimeCore.init())
	await reach_playing()
	transport.clear_calls()
	RealtimeCore.end_match()
	assert_eq(transport.calls, PackedStringArray(["send_packet(1, 0)", "close()"]))
	assert_eq(transport.packets, [PackedByteArray([1, 1, 2])] as Array[PackedByteArray])


func test_simulation_close_and_disconnect_send_the_held_packets_in_send_order_first() -> void:
	_start_time()
	assert_true(UnitTestCore.set_test_settings("RealtimeCore.simLatencyMs", 100))
	var recording: RealtimeRecordingTransport = RealtimeRecordingTransport.new(UnitTestCore.create_fake_realtime())
	var sim: SimRealtimeTransport = SimRealtimeTransport.new(recording)
	assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([0, 1])))
	assert_true(sim.send_packet(2, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([0, 2])))
	assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 1, 1])))
	sim.close()
	assert_eq(recording.calls, PackedStringArray(["send_packet(1, 0)", "send_packet(2, 1)", "send_packet(1, 0)", "close()"]))
	assert_eq(recording.packets, [PackedByteArray([0, 1]), PackedByteArray([0, 2]), PackedByteArray([1, 1, 1])] as Array[PackedByteArray])
	recording.clear_calls()
	assert_true(sim.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([0, 3])))
	sim.disconnect_all()
	assert_eq(recording.calls, PackedStringArray(["send_packet(1, 0)", "disconnect()"]))
	UnitTestCore.advance_clock(100, false)
	sim.poll()
	assert_eq(recording.packets.size(), 1, "no held packet is sent twice")


func test_force_peer_lost_closes_the_peer_through_the_transport() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	assert_true(RealtimeCoreDev.force_peer_lost(1))
	assert_eq(transport.calls, PackedStringArray(["force_close_peer(1)"]))
	await frames()
	assert_eq(events.lines, PackedStringArray(["disconnected:1"]))
	assert_has(transport.calls, "connect_peer(1)")


func test_force_matchmaker_lost_closes_the_matchmaker_connection_through_the_transport() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	assert_true(RealtimeCoreDev.force_matchmaker_lost())
	assert_eq(transport.calls, PackedStringArray(["force_close_matchmaker()"]))
	await frames()
	assert_eq(warn_logs(), 1)
	assert_eq(transport.count("rejoin"), 1)


func test_force_operations_outside_playing_or_on_a_not_connected_peer_fail() -> void:
	await start_realtime()
	assert_false(RealtimeCoreDev.force_peer_lost(1))
	assert_false(RealtimeCoreDev.force_matchmaker_lost())
	assert_eq(warn_logs(), 2)
	await reach_playing(3, 0)
	push_peer_lost(2)
	await frames()
	transport.clear_calls()
	assert_false(RealtimeCoreDev.force_peer_lost(2))
	assert_false(RealtimeCoreDev.force_peer_lost(0))
	assert_eq(warn_logs(), 2)
	assert_eq(transport.calls.size(), 0)


func test_request_step_outside_playing_or_without_a_lockstep_transport_fails() -> void:
	await start_realtime()
	assert_false(await RealtimeCoreDev.request_step(100))
	await reach_playing()
	assert_false(await RealtimeCoreDev.request_step(100))
	assert_eq(warn_logs(), 2)


func _start_time() -> void:
	set_settings()
	assert_true(LogCore.init())
	assert_true(EventCore.init())
	assert_true(TimeCore.init())


## Second bytes of the `Unreliable` packets a simulation seeded with `match_seed` delivers out of 40.
func _delivered_with_seed(match_seed: int) -> PackedByteArray:
	var fake_transport: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	var recording: RealtimeRecordingTransport = RealtimeRecordingTransport.new(fake_transport)
	var sim: SimRealtimeTransport = SimRealtimeTransport.new(recording)
	var info: MatchInfo = make_info()
	info.match_seed = match_seed
	var notice: RealtimeNotice = new_notice(RealtimeNotice.Kind.MATCH_FOUND)
	notice.match_info = info
	UnitTestCore.add_realtime_notice(fake_transport, notice)
	sim.poll()
	assert_eq(sim.take_notice().kind, RealtimeNotice.Kind.MATCH_FOUND)
	for i: int in 40:
		sim.send_packet(1, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([0, i]))
	sim.poll()
	var delivered: PackedByteArray = PackedByteArray()
	for packet: PackedByteArray in recording.packets:
		delivered.append(packet[1])
	return delivered
