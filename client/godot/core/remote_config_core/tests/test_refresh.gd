extends "res://core/remote_config_core/tests/support/remote_config_test_case.gd"
## `refresh` and the automatic refresh on background return.


func test_two_refreshes_at_once_send_one_request() -> void:
	await start()
	await login(config([]))
	UnitTestCore.add_pending(GET)
	var first: Call = start_refresh()
	var second: Call = start_refresh()
	assert_eq(request_count(GET), 1)
	var released: bool = UnitTestCore.release_pending(
		GET, NetworkCore.TransferResult.DONE, 200, response_bytes(config([int_entry(count, 42)]))
	)
	assert_true(released)
	assert_true(await wait_call(first))
	assert_true(await wait_call(second))
	assert_eq(request_count(GET), 1)
	assert_eq(RemoteConfigCore.get_int(count), 42)
	assert_eq(changed_events, 1)


func test_failed_refresh_keeps_values() -> void:
	await start()
	await login(config([bool_entry(flag, true)], [assignment(exp_a, "treatment")]))
	var events: int = changed_events
	# NetworkCore sends a request that failed in communication once more without a screen.
	UnitTestCore.add_result(GET, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
	UnitTestCore.add_result(GET, NetworkCore.TransferResult.CONNECTION_FAILED, 0, PackedByteArray())
	assert_false(await RemoteConfigCore.refresh())
	assert_eq(request_count(GET), 2)
	assert_eq(UnitTestCore.check_logs("error", "NetworkCore"), 1, "NetworkCore logs the failure")
	assert_eq(error_logs(), 0)
	assert_true(RemoteConfigCore.get_bool(flag))
	assert_eq(RemoteConfigCore.get_group(exp_a), "treatment")
	assert_eq(changed_events, events)
	add_get(config([]))
	assert_true(await RemoteConfigCore.refresh(), "a refresh after a failed one sends again")
	assert_eq(request_count(GET), 3)


func test_refresh_before_login_sends_nothing() -> void:
	await start()
	assert_false(await RemoteConfigCore.refresh())
	assert_eq(warn_logs(), 1)
	assert_eq(request_count(GET), 0)
	assert_false(RemoteConfigCore.has_received())


func test_background_return_refreshes_only_after_the_interval() -> void:
	await start()
	await login(config([]))
	UnitTestCore.advance_clock(INTERVAL_MS - 1, false)
	return_from_background(0)
	assert_eq(RemoteConfigCore._refresh, null, "the interval has not passed: no refresh")
	assert_eq(request_count(GET), 0)
	UnitTestCore.advance_clock(1, false)
	add_get(config([bool_entry(flag, true)]))
	var latch: UnitTestLatch = UnitTestCore.latch_event(RemoteConfigChangedEvent)
	return_from_background(0)
	await UnitTestCore.wait_latch(latch)
	assert_eq(request_count(GET), 1)
	assert_true(RemoteConfigCore.get_bool(flag))


func test_background_time_counts_toward_the_interval() -> void:
	await start()
	await login(config([]))
	UnitTestCore.advance_clock(HALF_INTERVAL_MS, false)
	return_from_background(HALF_INTERVAL_MS - 1)
	assert_eq(RemoteConfigCore._refresh, null, "real time plus background time is below the interval")
	assert_eq(request_count(GET), 0)
	add_get(config([bool_entry(flag, true)]))
	var latch: UnitTestLatch = UnitTestCore.latch_event(RemoteConfigChangedEvent)
	return_from_background(1)
	await UnitTestCore.wait_latch(latch)
	assert_true(TimeCore.get_real_time() < INTERVAL_MS, "real elapsed time alone is below the interval")
	assert_eq(request_count(GET), 1)
	assert_true(RemoteConfigCore.get_bool(flag))


func test_apply_restarts_the_interval() -> void:
	await start()
	await login(config([]))
	UnitTestCore.advance_clock(QUARTER_INTERVAL_MS, false)
	return_from_background(HALF_INTERVAL_MS)
	assert_eq(RemoteConfigCore._refresh, null, "real time plus background time is below the interval")
	add_get(config([]))
	assert_true(await RemoteConfigCore.refresh())
	assert_eq(request_count(GET), 1)
	# After the apply: real HALF plus background QUARTER. Counting the real QUARTER or the background HALF before the
	# apply would reach the interval.
	UnitTestCore.advance_clock(HALF_INTERVAL_MS, false)
	return_from_background(QUARTER_INTERVAL_MS)
	assert_eq(RemoteConfigCore._refresh, null, "the time and background before the last apply do not count")
	assert_eq(request_count(GET), 1)
	add_get(config([bool_entry(flag, true)]))
	var latch: UnitTestLatch = UnitTestCore.latch_event(RemoteConfigChangedEvent)
	return_from_background(QUARTER_INTERVAL_MS)
	await UnitTestCore.wait_latch(latch)
	assert_eq(request_count(GET), 2, "the background after the apply counts")
	assert_true(RemoteConfigCore.get_bool(flag))


func test_background_return_before_login_does_not_refresh() -> void:
	await start()
	UnitTestCore.advance_clock(INTERVAL_MS, true)
	assert_eq(RemoteConfigCore._refresh, null)
	assert_eq(request_count(GET), 0)
