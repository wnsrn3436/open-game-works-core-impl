extends "res://core/network_core/tests/support/network_test_case.gd"
## Input block and loading icon.


func test_interaction_and_retry_block_at_once() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var first: Sent = start_send(request(INTERACTION))
	assert_true(InputBlockCore.is_blocked(), "Interaction blocks at once")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(first))
	assert_false(InputBlockCore.is_blocked())
	UnitTestCore.add_pending(RETRY)
	var second: Sent = start_send(request(RETRY))
	assert_true(InputBlockCore.is_blocked(), "Retry blocks at once")
	assert_true(release_ok(RETRY))
	assert_true(await wait_sent(second))
	assert_false(InputBlockCore.is_blocked())


func test_silent_requests_do_not_block() -> void:
	await start_network()
	UnitTestCore.add_pending(SILENT)
	UnitTestCore.add_pending(SILENT_RETRY)
	var silent: Sent = start_send(request(SILENT))
	var silent_retry: Sent = start_send(request(SILENT_RETRY))
	assert_false(InputBlockCore.is_blocked())
	await advance(ICON_DELAY_MS + 100)
	assert_false(InputBlockCore.is_blocked())
	assert_false(loading_icon_visible())
	assert_true(release_ok(SILENT))
	assert_true(await wait_sent(silent))
	assert_false(InputBlockCore.is_blocked())
	assert_true(release_ok(SILENT_RETRY))
	assert_true(await wait_sent(silent_retry))


func test_system_popup_button_passes_the_network_block() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	assert_true(InputBlockCore.is_blocked())
	var pressed: PackedStringArray = PackedStringArray()
	var param: SystemPopupParam = SystemPopupParam.new()
	param.body = ReservedString.network_error_general()
	var button: SystemPopupButton = SystemPopupButton.new()
	button.label = ReservedString.network_confirm()
	button.callback = func() -> void: pressed.append("confirm")
	param.buttons.append(button)
	param.back_button = 0
	assert_true(await UICore.open_system_popup(param, Callable()))
	assert_true(await press_popup_button(ReservedString.network_confirm()))
	assert_eq(pressed.size(), 1, "the button callback runs under the network block")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(sent))


func test_loading_icon_after_the_delay() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	await advance(ICON_DELAY_MS - 1)
	assert_false(loading_icon_visible(), "no icon before the delay")
	await advance(2)
	assert_true(loading_icon_visible(), "icon after the delay")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(sent))
	await UnitTestCore.wait_frames(1)
	assert_false(loading_icon_visible(), "the icon goes with the block")


func test_no_block_or_icon_during_result_processing() -> void:
	await start_network()
	var seen: PackedStringArray = PackedStringArray()
	var env: CoreContract.ResponseEnvelope = envelope()
	env.user_state = tutorial_delta(PackedInt64Array([5]))
	UnitTestCore.add_pending(INTERACTION)
	var on_success: Callable = func(_response: ContractMessage) -> void:
		seen.append("blocked=%s icon=%s synced=%s" % [InputBlockCore.is_blocked(), loading_icon_visible(), TimeCore.is_synced()])
	var sent: Sent = start_send(request(INTERACTION), on_success)
	await advance(ICON_DELAY_MS + 100)
	assert_true(loading_icon_visible())
	assert_true(UnitTestCore.release_pending(INTERACTION, NetworkCore.TransferResult.DONE, 200, UnitTestCore.make_response(env)))
	assert_true(await wait_sent(sent))
	assert_eq(seen, PackedStringArray(["blocked=false icon=false synced=true"]))
	# A failure popup also opens without the block.
	UnitTestCore.add_pending(INTERACTION)
	var failed: Sent = start_send(request(INTERACTION))
	# The send again of failure flow 4 can start inside `release_pending`, so its result is registered first.
	add_connection_failure(INTERACTION)
	assert_true(UnitTestCore.release_pending(INTERACTION, NetworkCore.TransferResult.DONE, 500, PackedByteArray()))
	assert_false(await wait_sent(failed))
	await UnitTestCore.wait_frames(2)
	assert_true(popup_shows(ReservedString.network_error_connection()))
	assert_false(InputBlockCore.is_blocked())
	assert_false(loading_icon_visible())
	assert_eq(error_logs(), 1)


func test_queued_requests_go_one_by_one_in_order() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	UnitTestCore.add_pending(SILENT)
	var first: Sent = start_send(request(INTERACTION))
	var second: Sent = start_send(request(SILENT))
	assert_eq(request_count(), 1, "the second waits for the first")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(first))
	assert_eq(request_count(), 2)
	assert_true(release_ok(SILENT))
	assert_true(await wait_sent(second))
	assert_eq(completed, PackedStringArray([INTERACTION + ":true", SILENT + ":true"]))


func test_block_released_by_release_all_stays_released() -> void:
	await start_network()
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	assert_true(InputBlockCore.is_blocked())
	InputBlockCore.release_all()
	assert_eq(UnitTestCore.check_logs("warn", "InputBlockCore"), 1)
	var other: int = InputBlockCore.block("content")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(sent))
	assert_true(InputBlockCore.is_active(other), "the other block stays active")
	assert_true(InputBlockCore.unblock(other))


func test_token_wait_does_not_count_to_the_max_duration() -> void:
	await start_network()
	provider.hold_get = true
	UnitTestCore.add_pending(INTERACTION)
	var sent: Sent = start_send(request(INTERACTION))
	await advance(BLOCK_MAX_MS + 1000)
	provider.release_get()
	await advance(TIMEOUT_MS - 1)
	assert_true(InputBlockCore.is_blocked(), "no forced release")
	assert_true(release_ok(INTERACTION))
	assert_true(await wait_sent(sent))


func test_three_requests_near_the_timeout_do_not_force_release() -> void:
	await start_network()
	var sends: Array[Sent] = []
	for i: int in 3:
		UnitTestCore.add_pending(INTERACTION)
	for i: int in 3:
		sends.append(start_send(request(INTERACTION)))
	for i: int in 3:
		await advance(TIMEOUT_MS - 1)
		assert_true(InputBlockCore.is_blocked())
		assert_true(release_ok(INTERACTION))
		assert_true(await wait_sent(sends[i]))
	assert_eq(completed.size(), 3)
