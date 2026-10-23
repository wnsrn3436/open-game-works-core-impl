extends RealtimeTestCase
## `send`, the receive check, the `on_realtime_message` hook and the pending queue.


func test_send_failures_send_no_packet_and_log_as_the_table_says() -> void:
	await start_realtime()
	var bytes: PackedByteArray = PackedByteArray([7, 8])
	assert_false(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(warn_logs(), 1)
	await reach_playing(3, 0)
	push_peer_lost(2)
	await frames()
	transport.clear_calls()
	assert_false(RealtimeCore.send(3, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(error_logs(), 1)
	assert_false(RealtimeCore.send(-2, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(error_logs(), 1)
	assert_false(RealtimeCore.send(0, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(error_logs(), 1)
	assert_false(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray()))
	assert_eq(error_logs(), 1)
	var too_long: PackedByteArray = PackedByteArray()
	too_long.resize(MESSAGE_MAX_BYTES + 1)
	assert_false(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, too_long))
	assert_eq(error_logs(), 1)
	assert_false(RealtimeCore.send(2, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(warn_logs(), 0)
	assert_eq(error_logs(), 0)
	assert_eq(transport.count("send_packet"), 0)
	push_peer_lost(1)
	await frames()
	transport.clear_calls()
	assert_false(RealtimeCore.send(RealtimeCore.ALL, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(warn_logs(), 0)
	assert_eq(error_logs(), 0)
	assert_eq(transport.count("send_packet"), 0)


func test_send_to_all_calls_each_connected_other_once_and_goes_on_after_a_failure() -> void:
	await start_realtime()
	await reach_playing(4, 1)
	push_peer_lost(3)
	await frames()
	transport.clear_calls()
	var bytes: PackedByteArray = PackedByteArray([1, 2, 3])
	assert_true(RealtimeCore.send(RealtimeCore.ALL, RealtimeCore.RealtimeChannel.UNRELIABLE, bytes))
	assert_eq(transport.calls, PackedStringArray(["send_packet(0, 1)", "send_packet(2, 1)"]))
	transport.clear_calls()
	UnitTestCore.set_realtime_send_result(fake, 0, false)
	assert_false(RealtimeCore.send(RealtimeCore.ALL, RealtimeCore.RealtimeChannel.UNRELIABLE, bytes))
	assert_eq(transport.calls, PackedStringArray(["send_packet(0, 1)", "send_packet(2, 1)"]))


func test_send_puts_kind_zero_before_the_bytes() -> void:
	await start_realtime()
	await reach_playing()
	transport.clear_calls()
	var bytes: PackedByteArray = PackedByteArray([9, 0, 255])
	assert_true(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.RELIABLE, bytes))
	assert_eq(transport.packets.size(), 1)
	assert_eq(transport.packets[0], PackedByteArray([0, 9, 0, 255]))
	assert_eq(transport.calls, PackedStringArray(["send_packet(1, 0)"]))
	bytes[0] = 4
	assert_true(RealtimeCore.send(1, RealtimeCore.RealtimeChannel.UNRELIABLE, bytes))
	assert_eq(transport.packets[1], PackedByteArray([0, 4, 0, 255]))


func test_received_messages_go_to_the_hook_in_receive_order() -> void:
	await start_realtime()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await reach_playing(3, 0)
	push_message(2, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([1]))
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([2, 3]))
	push_message(2, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([4]))
	await frames()
	assert_eq(owner.messages, PackedStringArray(["2:1:01", "1:0:0203", "2:0:04"]))


func test_a_hook_that_throws_logs_one_error_a_match_and_gets_the_next_messages() -> void:
	await start_realtime()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message_throwing))
	await reach_playing(3, 0)
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([RealtimeHookOwner.THROW]))
	push_message(2, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1]))
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([RealtimeHookOwner.THROW, 2]))
	await frames()
	assert_eq(UnitTestCore.check_script_errors(), 2, "the hook threw for two messages")
	assert_eq(error_logs(), 1, "one error log in the match")
	assert_eq(owner.messages, PackedStringArray(["1:0:ff", "2:0:01", "1:0:ff02"]), "the hook got every message")


func test_receive_check_drops_bad_packets_with_a_warning_each() -> void:
	await start_realtime()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await reach_playing(3, 0)
	var too_long: PackedByteArray = PackedByteArray([0])
	too_long.resize(MESSAGE_MAX_BYTES + 2)
	var bad: Array[PackedByteArray] = [
		PackedByteArray([2, 1]),
		PackedByteArray(),
		PackedByteArray([0]),
		too_long,
		PackedByteArray([1, 9, 1]),
		PackedByteArray([1, 1, 3]),
		PackedByteArray([1, 1, 1, 0]),
		PackedByteArray([1, 2, 0, 0, 0, 1, 0, 0, 0, 5]),
		PackedByteArray([1, 3, 0, 0, 0, 1]),
		PackedByteArray([1, 4, 0, 0, 0, 5]),
	]
	for packet: PackedByteArray in bad:
		push_packet(1, RealtimeCore.RealtimeChannel.RELIABLE, packet)
		await frames(1)
		assert_eq(warn_logs(), 1)
	push_packet(1, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([1, 1, 1]))
	await frames(1)
	assert_eq(warn_logs(), 1)
	assert_eq(owner.messages.size(), 0)
	assert_eq(RealtimeCore.peer_state(1), RealtimeCore.PeerState.CONNECTED)
	assert_eq(events.count("left"), 0)


func test_receive_check_drops_without_logs_outside_a_match_and_from_a_left_participant() -> void:
	await start_realtime()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1]))
	await frames()
	assert_eq(warn_logs(), 0)
	await reach_playing(3, 0)
	push_leave_notice(2, 1)
	await frames()
	push_message(2, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1]))
	push_packet(2, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([7]))
	await frames()
	assert_eq(warn_logs(), 0)
	assert_eq(owner.messages.size(), 0)


func test_pending_messages_go_first_to_the_hook_registered_later() -> void:
	await start_realtime()
	await reach_playing(3, 0)
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1]))
	push_message(2, RealtimeCore.RealtimeChannel.UNRELIABLE, PackedByteArray([2]))
	await frames()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([3]))
	await frames(1)
	assert_eq(owner.messages, PackedStringArray(["1:0:01", "2:1:02", "1:0:03"]))


func test_full_pending_queue_drops_new_messages_with_one_error_per_match() -> void:
	await start_realtime()
	await reach_playing()
	for i: int in PENDING_MAX + 2:
		push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([i]))
	await frames()
	assert_eq(error_logs(), 1)
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await frames(1)
	assert_eq(owner.messages, PackedStringArray(["1:0:00", "1:0:01", "1:0:02"]))


func test_messages_of_an_ended_match_do_not_go_to_a_later_hook() -> void:
	await start_realtime()
	await reach_playing()
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([1]))
	await frames()
	RealtimeCore.end_match()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await frames()
	assert_eq(owner.messages.size(), 0)


func test_hook_is_called_while_paused() -> void:
	await start_realtime()
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_true(RealtimeCore.register_on_realtime_message(owner.on_message))
	await reach_playing()
	TimeCore.set_paused(true)
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([5]))
	await frames()
	TimeCore.set_paused(false)
	assert_eq(owner.messages, PackedStringArray(["1:0:05"]))


func test_hook_of_a_destroyed_owner_is_not_called_and_another_owner_can_register() -> void:
	await start_realtime()
	var first: RealtimeHookOwner = RealtimeHookOwner.new()
	assert_true(RealtimeCore.register_on_realtime_message(first.on_message))
	var second: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_false(RealtimeCore.register_on_realtime_message(second.on_message))
	assert_eq(error_logs(), 1)
	await reach_playing()
	first.free()
	push_message(1, RealtimeCore.RealtimeChannel.RELIABLE, PackedByteArray([6]))
	await frames()
	assert_true(RealtimeCore.register_on_realtime_message(second.on_message))
	await frames(1)
	assert_eq(second.messages, PackedStringArray(["1:0:06"]))
	assert_eq(error_logs(), 0)


func test_hook_registration_refuses_a_lambda_a_bound_callable_and_a_non_node_method() -> void:
	await start_realtime()
	var lambda: Callable = func(_p: int, _c: RealtimeCore.RealtimeChannel, _b: PackedByteArray) -> void: pass
	assert_false(RealtimeCore.register_on_realtime_message(lambda))
	var owner: RealtimeHookOwner = add_node(RealtimeHookOwner.new()) as RealtimeHookOwner
	assert_false(RealtimeCore.register_on_realtime_message(owner.on_message.bind(1)))
	var holder: RealtimeAsyncCall = RealtimeAsyncCall.new()
	assert_false(RealtimeCore.register_on_realtime_message(holder.wait))
	assert_eq(error_logs(), 3)
