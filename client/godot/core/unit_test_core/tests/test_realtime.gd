extends UnitTestCase
## Fake realtime transport: notifications at the next poll in order, recorded calls, send results, and the transport
## DEV operations.


func _notice(kind: RealtimeNotice.Kind, participant: int) -> RealtimeNotice:
	var notice: RealtimeNotice = RealtimeNotice.new()
	notice.reset(kind)
	notice.participant = participant
	return notice


func test_notifications_come_at_the_next_poll_in_order() -> void:
	var transport: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	UnitTestCore.add_realtime_notice(transport, _notice(RealtimeNotice.Kind.PEER_CONNECTED, 1))
	UnitTestCore.add_realtime_notice(transport, _notice(RealtimeNotice.Kind.PEER_LOST, 2))
	assert_eq(transport.notice_count(), 0, "nothing before poll")
	transport.poll()
	var first: RealtimeNotice = transport.take_notice()
	var second: RealtimeNotice = transport.take_notice()
	assert_not_null(first)
	assert_not_null(second)
	if first != null and second != null:
		assert_eq([first.kind, first.participant], [RealtimeNotice.Kind.PEER_CONNECTED, 1])
		assert_eq([second.kind, second.participant], [RealtimeNotice.Kind.PEER_LOST, 2])
	assert_null(transport.take_notice())
	transport.poll()
	assert_eq(transport.notice_count(), 0, "a notification comes once")


func test_calls_are_recorded_in_order_and_send_results_follow_the_participant() -> void:
	var transport: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	UnitTestCore.set_realtime_send_result(transport, 2, false)
	transport.start_matching(3, "token", false)
	transport.connect_peer(1)
	assert_true(transport.send_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1, 2])))
	assert_false(transport.send_packet(2, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([3])))
	transport.poll()
	assert_eq(transport.lockstep_time(), RealtimeTransport.NO_TIME)
	transport.disconnect_all()
	var names: PackedStringArray = PackedStringArray()
	for entry: UnitTestRealtimeCall in UnitTestCore.realtime_calls(transport):
		names.append(entry.name)
	assert_eq(names, PackedStringArray(["start_matching", "connect_peer", "send_packet", "send_packet", "disconnect"]))
	var calls: Array[UnitTestRealtimeCall] = UnitTestCore.realtime_calls(transport)
	if calls.size() == 5:
		assert_eq(calls[0].inputs, PackedStringArray(["3", "token", "false"]))
		assert_eq(calls[2].inputs, PackedStringArray(["1", str(RealtimeCore.RealtimeChannel.RELIABLE), "0102"]))


func test_dev_operations_give_a_peer_lost_and_a_matchmaker_lost_at_the_next_poll() -> void:
	var transport: UnitTestRealtimeTransport = UnitTestCore.create_fake_realtime()
	transport.force_close_peer(1)
	transport.force_close_matchmaker()
	assert_eq(transport.notice_count(), 0, "nothing before poll")
	transport.poll()
	var lost: RealtimeNotice = transport.take_notice()
	var matchmaker: RealtimeNotice = transport.take_notice()
	assert_not_null(lost)
	assert_not_null(matchmaker)
	if lost != null and matchmaker != null:
		assert_eq([lost.kind, lost.participant], [RealtimeNotice.Kind.PEER_LOST, 1])
		assert_eq([matchmaker.kind, matchmaker.error_code], [RealtimeNotice.Kind.MATCHMAKER_LOST, 0])
	var names: PackedStringArray = PackedStringArray()
	for entry: UnitTestRealtimeCall in UnitTestCore.realtime_calls(transport):
		names.append(entry.name)
	assert_eq(names, PackedStringArray(["force_close_peer", "force_close_matchmaker"]))
	assert_null(transport.take_notice())
