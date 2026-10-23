extends "res://core/network_core/tests/support/network_test_case.gd"
## `release` while a request is sent.


func test_release_while_sending_cancels_and_drops_everything() -> void:
	await start_network()
	var calls: PackedStringArray = PackedStringArray()
	var on_success: Callable = func(_response: ContractMessage) -> void:
		calls.append("success")
	var on_failure: Callable = func(_failure: RequestFailure) -> bool:
		calls.append("failure")
		return false
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION), on_success, on_failure)
	var queued: Sent = start_send(request(INTERACTION), on_success, on_failure)
	await advance(ICON_DELAY_MS + 100)
	assert_true(InputBlockCore.is_blocked())
	assert_true(loading_icon_visible())
	NetworkCore.release()
	assert_eq(UnitTestCore.cancel_count(), 1)
	assert_false(InputBlockCore.is_blocked())
	assert_false(await wait_sent(sent))
	assert_false(await wait_sent(queued))
	await UnitTestCore.wait_frames(2)
	assert_false(loading_icon_visible())
	release_ok(INTERACTION)
	await UnitTestCore.wait_frames(2)
	assert_eq(calls.size(), 0, "no callback")
	assert_eq(completed.size(), 0, "no event")
	assert_false(TimeCore.is_synced(), "no time sync")
